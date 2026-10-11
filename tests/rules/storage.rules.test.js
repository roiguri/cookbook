/**
 * Storage security rules — recipe images and media instructions.
 *
 * Delete/overwrite checks look up the recipe author and the user's role in
 * Firestore (cross-service rules), so both emulators run. Set STORAGE_RULES /
 * FIRESTORE_RULES to compare against other rules files.
 */
import { readFileSync } from 'node:fs';
import {
  initializeTestEnvironment,
  assertFails,
  assertSucceeds,
} from '@firebase/rules-unit-testing';
import { doc, setDoc } from 'firebase/firestore';
import { ref, uploadBytes, deleteObject, getBytes } from 'firebase/storage';

const STORAGE_RULES = process.env.STORAGE_RULES || 'storage.rules';
const FIRESTORE_RULES = process.env.FIRESTORE_RULES || 'firestore.rules';

let testEnv;

const AUTHOR = 'author-uid';
const UPLOADER = 'uploader-uid';
const OTHER = 'other-uid';
const MANAGER = 'manager-uid';

const IMAGE = 'img/recipes/full/breads/recipe1/primary.jpg';
const SUGGESTED = 'img/recipes/full/breads/recipe1/img-123.jpg';
const MEDIA = 'recipes/recipe1/media-instructions/m1_step.jpg';
const NEW_RECIPE_IMAGE = 'img/recipes/full/breads/not-created-yet/primary.jpg';
const MODERN_IMAGE = 'img/recipes/full/breads/recipe2/primary.jpg'; // recipe with authorId only

const bytes = new Uint8Array([0xff, 0xd8, 0xff, 0xe0]);
const meta = (uid) => ({
  contentType: 'image/jpeg',
  customMetadata: uid ? { uploadedBy: uid } : {},
});

const storage = (uid) =>
  uid ? testEnv.authenticatedContext(uid).storage() : testEnv.unauthenticatedContext().storage();

beforeAll(async () => {
  testEnv = await initializeTestEnvironment({
    projectId: 'demo-cookbook',
    firestore: { rules: readFileSync(FIRESTORE_RULES, 'utf8') },
    storage: { rules: readFileSync(STORAGE_RULES, 'utf8') },
  });
});

afterAll(async () => {
  await testEnv?.cleanup();
});

beforeEach(async () => {
  await testEnv.clearFirestore();
  await testEnv.clearStorage();
  await testEnv.withSecurityRulesDisabled(async (ctx) => {
    const admin = ctx.firestore();
    await setDoc(doc(admin, 'users', AUTHOR), { role: 'approved' });
    await setDoc(doc(admin, 'users', UPLOADER), { role: 'approved' });
    await setDoc(doc(admin, 'users', OTHER), { role: 'approved' });
    await setDoc(doc(admin, 'users', MANAGER), { role: 'manager' });
    await setDoc(doc(admin, 'recipes', 'recipe1'), { userId: AUTHOR, approved: true });
    await setDoc(doc(admin, 'recipes', 'recipe2'), {
      authorId: AUTHOR,
      visibility: 'private',
      approved: false,
      stage: 'tested',
    });

    const files = ctx.storage();
    // An existing image with no uploader tag, as every file uploaded before this release.
    await uploadBytes(ref(files, IMAGE), bytes, meta(null));
    // An edit-suggestion image uploaded by someone other than the author.
    await uploadBytes(ref(files, SUGGESTED), bytes, meta(UPLOADER));
    await uploadBytes(ref(files, MEDIA), bytes, meta(null));
    await uploadBytes(ref(files, MODERN_IMAGE), bytes, meta(null));
  });
});

describe('reading', () => {
  test('recipe images and media are public', async () => {
    await assertSucceeds(getBytes(ref(storage(null), IMAGE)));
    await assertSucceeds(getBytes(ref(storage(null), MEDIA)));
  });
});

describe('uploading', () => {
  test('a signed-in user can upload a new image tagged with their own id', async () => {
    await assertSucceeds(uploadBytes(ref(storage(OTHER), NEW_RECIPE_IMAGE), bytes, meta(OTHER)));
  });

  test('an upload tagged with someone else’s id is rejected', async () => {
    await assertFails(uploadBytes(ref(storage(OTHER), NEW_RECIPE_IMAGE), bytes, meta(AUTHOR)));
  });

  test('an upload with no uploader tag is rejected', async () => {
    await assertFails(uploadBytes(ref(storage(OTHER), NEW_RECIPE_IMAGE), bytes, meta(null)));
  });

  test('signed-out visitors cannot upload', async () => {
    await assertFails(uploadBytes(ref(storage(null), NEW_RECIPE_IMAGE), bytes, meta(null)));
  });

  test('another user cannot overwrite an existing recipe image', async () => {
    await assertFails(uploadBytes(ref(storage(OTHER), IMAGE), bytes, meta(OTHER)));
  });

  test('a manager can overwrite an existing recipe image', async () => {
    await assertSucceeds(uploadBytes(ref(storage(MANAGER), IMAGE), bytes, meta(MANAGER)));
  });
});

describe('deleting', () => {
  test('another user cannot delete a recipe image', async () => {
    await assertFails(deleteObject(ref(storage(OTHER), IMAGE)));
    await assertFails(deleteObject(ref(storage(OTHER), SUGGESTED)));
  });

  test('another user cannot delete media instructions', async () => {
    await assertFails(deleteObject(ref(storage(OTHER), MEDIA)));
  });

  test('the uploader can delete their own file (failed or rejected suggestion cleanup)', async () => {
    await assertSucceeds(deleteObject(ref(storage(UPLOADER), SUGGESTED)));
  });

  test('the recipe author can delete images of their recipe', async () => {
    await assertSucceeds(deleteObject(ref(storage(AUTHOR), IMAGE))); // legacy userId
    await assertSucceeds(deleteObject(ref(storage(AUTHOR), MODERN_IMAGE))); // authorId
  });

  test('another user cannot delete images of a recipe identified by authorId', async () => {
    await assertFails(deleteObject(ref(storage(OTHER), MODERN_IMAGE)));
  });

  test('a manager can delete any recipe image or media', async () => {
    await assertSucceeds(deleteObject(ref(storage(MANAGER), IMAGE)));
    await assertSucceeds(deleteObject(ref(storage(MANAGER), MEDIA)));
  });
});
