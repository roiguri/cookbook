/**
 * Storage security rules — recipe files, suggestion staging, private user area,
 * and the legacy (pre-2b) trees.
 *
 * Author/role checks look up Firestore (cross-service rules), so both emulators
 * run. Set STORAGE_RULES / FIRESTORE_RULES to compare against other rules files.
 */
import { readFileSync } from 'node:fs';
import {
  initializeTestEnvironment,
  assertFails,
  assertSucceeds,
} from '@firebase/rules-unit-testing';
import { doc, setDoc, updateDoc } from 'firebase/firestore';
import { ref, uploadBytes, deleteObject, getBytes, listAll } from 'firebase/storage';

const STORAGE_RULES = process.env.STORAGE_RULES || 'storage.rules';
const FIRESTORE_RULES = process.env.FIRESTORE_RULES || 'firestore.rules';

let testEnv;

const AUTHOR = 'author-uid';
const UPLOADER = 'uploader-uid';
const OTHER = 'other-uid';
const MANAGER = 'manager-uid';

// Current layout (release 2b)
const IMAGE = 'recipes/recipe1/images/primary.jpg'; // recipe1: published
const MODERN_IMAGE = 'recipes/recipe2/images/primary.jpg'; // recipe2: authorId author
const MEDIA = 'recipes/recipe1/media/m1_step.jpg';
const UPLOADED = 'recipes/recipe1/images/1700000000.jpg'; // tagged by UPLOADER (published recipe)
const UPLOADED_PRIVATE = 'recipes/recipe2/images/1700000002.jpg'; // tagged by UPLOADER (private recipe)
const NEW_RECIPE_IMAGE = 'recipes/not-created-yet/images/primary.jpg';
const STAGED = 'suggestions/s1/images/1700000001.jpg'; // edit suggestion by UPLOADER
const PRIVATE = `users/${AUTHOR}/recipes/r9/images/primary.jpg`;
// Legacy layout (before 2b)
const LEGACY_IMAGE = 'img/recipes/full/breads/recipe1/primary.jpg';
const LEGACY_MEDIA = 'recipes/recipe1/media-instructions/m0_step.jpg';

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
    for (const [uid, role] of [
      [AUTHOR, 'approved'],
      [UPLOADER, 'approved'],
      [OTHER, 'approved'],
      [MANAGER, 'manager'],
    ]) {
      await setDoc(doc(admin, 'users', uid), { role });
    }
    await setDoc(doc(admin, 'recipes', 'recipe1'), {
      authorId: AUTHOR,
      visibility: 'published',
      stage: 'tested',
    });
    await setDoc(doc(admin, 'recipes', 'recipe2'), {
      authorId: AUTHOR,
      visibility: 'private',
      approved: false,
      stage: 'tested',
    });

    const files = ctx.storage();
    for (const [path, tag] of [
      [IMAGE, null], // files from before uploads were tagged
      [MODERN_IMAGE, null],
      [MEDIA, null],
      [UPLOADED, UPLOADER],
      [UPLOADED_PRIVATE, UPLOADER],
      [STAGED, UPLOADER],
      [PRIVATE, AUTHOR],
      [LEGACY_IMAGE, null],
      [LEGACY_MEDIA, null],
    ]) {
      await uploadBytes(ref(files, path), bytes, meta(tag));
    }
  });
});

describe('recipe files (recipes/{id}/images|media)', () => {
  test('are public to read', async () => {
    await assertSucceeds(getBytes(ref(storage(null), IMAGE)));
    await assertSucceeds(getBytes(ref(storage(null), MEDIA)));
  });

  test('a signed-in user can upload a new file tagged with their own id', async () => {
    await assertSucceeds(uploadBytes(ref(storage(OTHER), NEW_RECIPE_IMAGE), bytes, meta(OTHER)));
  });

  test('uploads with someone else’s tag, no tag, or signed out are rejected', async () => {
    await assertFails(uploadBytes(ref(storage(OTHER), NEW_RECIPE_IMAGE), bytes, meta(AUTHOR)));
    await assertFails(uploadBytes(ref(storage(OTHER), NEW_RECIPE_IMAGE), bytes, meta(null)));
    await assertFails(uploadBytes(ref(storage(null), NEW_RECIPE_IMAGE), bytes, meta(null)));
  });

  test('only images and media folders accept uploads', async () => {
    await assertFails(
      uploadBytes(ref(storage(OTHER), 'recipes/recipe1/other/x.jpg'), bytes, meta(OTHER)),
    );
  });

  test('another user cannot overwrite or delete a recipe file', async () => {
    await assertFails(uploadBytes(ref(storage(OTHER), IMAGE), bytes, meta(OTHER)));
    await assertFails(deleteObject(ref(storage(OTHER), IMAGE)));
    await assertFails(deleteObject(ref(storage(OTHER), MEDIA)));
    await assertFails(deleteObject(ref(storage(OTHER), MODERN_IMAGE)));
  });

  test('while the recipe is private, the uploader and the author can change its files', async () => {
    await assertSucceeds(deleteObject(ref(storage(UPLOADER), UPLOADED_PRIVATE)));
    await assertSucceeds(deleteObject(ref(storage(AUTHOR), MODERN_IMAGE)));
  });

  test('once published, the author and the uploader can no longer change its files', async () => {
    // recipe1 is published
    await assertFails(deleteObject(ref(storage(AUTHOR), IMAGE)));
    await assertFails(deleteObject(ref(storage(UPLOADER), UPLOADED)));
    // and the same once a private recipe is published
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      await updateDoc(doc(ctx.firestore(), 'recipes', 'recipe2'), {
        visibility: 'published',
        approved: true,
      });
    });
    await assertFails(deleteObject(ref(storage(AUTHOR), MODERN_IMAGE)));
    await assertFails(deleteObject(ref(storage(UPLOADER), UPLOADED_PRIVATE)));
  });

  test('the uploader can clean up after a failed save (recipe not created yet)', async () => {
    const path = 'recipes/failed-save/images/1700000003.jpg'; // its own path: storage isn't reset between tests
    await assertSucceeds(uploadBytes(ref(storage(UPLOADER), path), bytes, meta(UPLOADER)));
    await assertFails(deleteObject(ref(storage(OTHER), path)));
    await assertSucceeds(deleteObject(ref(storage(UPLOADER), path)));
  });

  test('a manager can overwrite and delete any recipe file', async () => {
    await assertSucceeds(uploadBytes(ref(storage(MANAGER), IMAGE), bytes, meta(MANAGER)));
    await assertSucceeds(deleteObject(ref(storage(MANAGER), MEDIA)));
  });
});

describe('edit-suggestion staging (suggestions/{id}/…)', () => {
  test('a signed-in user can stage files tagged as their own', async () => {
    await assertSucceeds(
      uploadBytes(ref(storage(OTHER), 'suggestions/s2/images/1.jpg'), bytes, meta(OTHER)),
    );
    await assertSucceeds(
      uploadBytes(ref(storage(OTHER), 'suggestions/s2/media/m_1.jpg'), bytes, meta(OTHER)),
    );
  });

  test('the uploader and managers can read and delete staged files; others cannot', async () => {
    await assertSucceeds(getBytes(ref(storage(UPLOADER), STAGED)));
    await assertSucceeds(getBytes(ref(storage(MANAGER), STAGED)));
    await assertFails(getBytes(ref(storage(OTHER), STAGED)));
    await assertFails(getBytes(ref(storage(null), STAGED)));
    await assertFails(deleteObject(ref(storage(OTHER), STAGED)));
    await assertSucceeds(deleteObject(ref(storage(UPLOADER), STAGED)));
  });

  test('nobody overwrites a staged file', async () => {
    await assertFails(uploadBytes(ref(storage(UPLOADER), STAGED), bytes, meta(UPLOADER)));
  });
});

describe('private user area (users/{uid}/…)', () => {
  test('the owner can write, read and delete their files', async () => {
    const path = `users/${AUTHOR}/recipes/r9/images/2.jpg`;
    await assertSucceeds(uploadBytes(ref(storage(AUTHOR), path), bytes, meta(AUTHOR)));
    await assertSucceeds(getBytes(ref(storage(AUTHOR), PRIVATE)));
    await assertSucceeds(deleteObject(ref(storage(AUTHOR), path)));
  });

  test('managers can read but not write someone’s private files', async () => {
    await assertSucceeds(getBytes(ref(storage(MANAGER), PRIVATE)));
    await assertFails(
      uploadBytes(ref(storage(MANAGER), `users/${AUTHOR}/x.jpg`), bytes, meta(MANAGER)),
    );
  });

  test('other users and visitors cannot read or write someone’s private files', async () => {
    await assertFails(getBytes(ref(storage(OTHER), PRIVATE)));
    await assertFails(getBytes(ref(storage(null), PRIVATE)));
    await assertFails(
      uploadBytes(ref(storage(OTHER), `users/${AUTHOR}/x.jpg`), bytes, meta(OTHER)),
    );
    await assertFails(deleteObject(ref(storage(OTHER), PRIVATE)));
  });
});

// Recipe sharing (R3): a private recipe's photos follow its share records.
describe('photos of a shared private recipe', () => {
  const SHARED_WITH = 'shared-with-uid';
  const PLAIN = 'plain-uid';

  beforeEach(async () => {
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      const admin = ctx.firestore();
      await setDoc(doc(admin, 'users', SHARED_WITH), { role: 'approved' });
      await setDoc(doc(admin, 'users', PLAIN), { role: 'user' });
      await setDoc(doc(admin, 'recipes', 'r9'), {
        authorId: AUTHOR,
        visibility: 'private',
        stage: 'tested',
      });
      for (const uid of [SHARED_WITH, PLAIN]) {
        await setDoc(doc(admin, 'recipes', 'r9', 'shares', uid), {
          recipientUid: uid,
          authorId: AUTHOR,
          authorName: 'Author Name',
          sharedAt: new Date(),
        });
      }
    });
  });

  test('are readable by someone it is shared with', async () => {
    await assertSucceeds(getBytes(ref(storage(SHARED_WITH), PRIVATE)));
  });

  test('stay closed to others, to visitors and to a recipient who is no longer approved', async () => {
    await assertFails(getBytes(ref(storage(OTHER), PRIVATE)));
    await assertFails(getBytes(ref(storage(null), PRIVATE)));
    await assertFails(getBytes(ref(storage(PLAIN), PRIVATE)));
  });

  test('only for that recipe, in its author’s folder', async () => {
    const elsewhere = `users/${OTHER}/recipes/r9/images/primary.jpg`;
    await testEnv.withSecurityRulesDisabled((ctx) =>
      uploadBytes(ref(ctx.storage(), elsewhere), bytes, meta(OTHER)),
    );
    await assertFails(getBytes(ref(storage(SHARED_WITH), elsewhere)));
  });

  test('a recipient cannot write or delete them', async () => {
    await assertFails(
      uploadBytes(
        ref(storage(SHARED_WITH), `users/${AUTHOR}/recipes/r9/images/3.jpg`),
        bytes,
        meta(SHARED_WITH),
      ),
    );
    await assertFails(deleteObject(ref(storage(SHARED_WITH), PRIVATE)));
  });
});

describe('legacy trees (before 2b)', () => {
  test('stay public to read', async () => {
    await assertSucceeds(getBytes(ref(storage(null), LEGACY_IMAGE)));
    await assertSucceeds(getBytes(ref(storage(null), LEGACY_MEDIA)));
  });

  test('no longer accept uploads or deletes from non-managers, the author included', async () => {
    await assertFails(
      uploadBytes(
        ref(storage(AUTHOR), 'img/recipes/full/breads/recipe1/new.jpg'),
        bytes,
        meta(AUTHOR),
      ),
    );
    await assertFails(deleteObject(ref(storage(AUTHOR), LEGACY_IMAGE)));
    await assertFails(
      uploadBytes(
        ref(storage(AUTHOR), 'recipes/recipe1/media-instructions/new.jpg'),
        bytes,
        meta(AUTHOR),
      ),
    );
  });

  test('managers can still clean them up', async () => {
    await assertSucceeds(deleteObject(ref(storage(MANAGER), LEGACY_IMAGE)));
    await assertSucceeds(deleteObject(ref(storage(MANAGER), LEGACY_MEDIA)));
  });
});

describe('built avatars (user-avatars/{uid}.png)', () => {
  const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47]);
  const pngMeta = (uid) => ({ contentType: 'image/png', customMetadata: { uploadedBy: uid } });
  const avatar = (uid) => `user-avatars/${uid}.png`;
  const upload = (as, path, bytes = png, metadata = pngMeta(as)) =>
    uploadBytes(ref(storage(as), path), bytes, metadata);

  test('a user can upload and replace their own avatar PNG', async () => {
    await assertSucceeds(upload(AUTHOR, avatar(AUTHOR)));
    await assertSucceeds(upload(AUTHOR, avatar(AUTHOR)));
  });

  test("nobody can write another user's avatar, managers included", async () => {
    await assertFails(upload(OTHER, avatar(AUTHOR)));
    await assertFails(upload(MANAGER, avatar(AUTHOR)));
  });

  test('signed-out visitors cannot upload', async () => {
    await assertFails(uploadBytes(ref(storage(null), avatar(AUTHOR)), png, pngMeta(AUTHOR)));
  });

  test('only a PNG named after the uid is accepted', async () => {
    await assertFails(
      upload(AUTHOR, `user-avatars/${AUTHOR}.svg`, png, {
        ...pngMeta(AUTHOR),
        contentType: 'image/svg+xml',
      }),
    );
    await assertFails(
      upload(AUTHOR, avatar(AUTHOR), png, { ...pngMeta(AUTHOR), contentType: 'image/svg+xml' }),
    );
    await assertFails(upload(AUTHOR, `user-avatars/${AUTHOR}-2.png`));
    await assertFails(upload(AUTHOR, `user-avatars/x/${AUTHOR}.png`));
  });

  test('the upload must be tagged with the uploader', async () => {
    await assertFails(upload(AUTHOR, avatar(AUTHOR), png, { contentType: 'image/png' }));
    await assertFails(upload(AUTHOR, avatar(AUTHOR), png, pngMeta(OTHER)));
  });

  test('files of 200 KB or more are rejected', async () => {
    await assertFails(upload(AUTHOR, avatar(AUTHOR), new Uint8Array(200 * 1024)));
    await assertSucceeds(upload(AUTHOR, avatar(AUTHOR), new Uint8Array(150 * 1024)));
  });

  test('the owner and managers can read it; others only through the saved download URL', async () => {
    await testEnv.withSecurityRulesDisabled((ctx) =>
      uploadBytes(ref(ctx.storage(), avatar(AUTHOR)), png, pngMeta(AUTHOR)),
    );
    await assertSucceeds(getBytes(ref(storage(AUTHOR), avatar(AUTHOR))));
    await assertSucceeds(getBytes(ref(storage(MANAGER), avatar(AUTHOR))));
    await assertFails(getBytes(ref(storage(OTHER), avatar(AUTHOR))));
    await assertFails(getBytes(ref(storage(null), avatar(AUTHOR))));
  });

  test('nobody can list the folder (it would list user ids)', async () => {
    await assertFails(listAll(ref(storage(AUTHOR), 'user-avatars')));
    await assertFails(listAll(ref(storage(null), 'user-avatars')));
  });

  test('the owner and managers can delete it; others cannot', async () => {
    const seed = () =>
      testEnv.withSecurityRulesDisabled((ctx) =>
        uploadBytes(ref(ctx.storage(), avatar(AUTHOR)), png, pngMeta(AUTHOR)),
      );
    await seed();
    await assertFails(deleteObject(ref(storage(OTHER), avatar(AUTHOR))));
    await assertSucceeds(deleteObject(ref(storage(AUTHOR), avatar(AUTHOR))));
    await seed();
    await assertSucceeds(deleteObject(ref(storage(MANAGER), avatar(AUTHOR))));
  });
});
