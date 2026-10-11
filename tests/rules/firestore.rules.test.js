/**
 * Firestore security rules — recipes and recipe submissions.
 *
 * Runs against the emulator via `npm run test:rules`. Set FIRESTORE_RULES to a
 * different rules file to compare (e.g. the previous release's rules).
 *
 * Recipe documents here have the release-2 shape: `authorId` + `visibility` +
 * `stage`, with the legacy `userId` + `approved` still present and in sync.
 */
import { readFileSync } from 'node:fs';
import {
  initializeTestEnvironment,
  assertFails,
  assertSucceeds,
} from '@firebase/rules-unit-testing';
import {
  doc,
  getDoc,
  setDoc,
  updateDoc,
  deleteDoc,
  collection,
  query,
  where,
  getDocs,
  writeBatch,
  serverTimestamp,
} from 'firebase/firestore';

const RULES = process.env.FIRESTORE_RULES || 'firestore.rules';

let testEnv;

const AUTHOR = 'author-uid';
const OTHER = 'other-uid';
const USER = 'plain-user-uid'; // role 'user'
const MANAGER = 'manager-uid';

const shape = (authorId, visibility) => ({
  authorId,
  ...(authorId ? { userId: authorId } : {}),
  visibility,
  approved: visibility === 'published',
  stage: 'tested',
});
const published = { name: 'Challah', category: 'breads', ...shape(AUTHOR, 'published') };
const pending = { name: 'Kubbeh', category: 'soups', ...shape(AUTHOR, 'private') };
const legacy = { name: 'Old recipe', category: 'mains', ...shape(null, 'published') };
const newPrivate = (uid) => ({ name: 'New', ...shape(uid, 'private') });

const db = (uid) =>
  uid
    ? testEnv.authenticatedContext(uid).firestore()
    : testEnv.unauthenticatedContext().firestore();

const submission = (recipeId, authorId, extra = {}) => ({
  recipeId,
  authorId,
  status: 'pending',
  reviewedBy: null,
  reviewedAt: null,
  rejectionReason: null,
  publishedId: null,
  ...extra,
});

beforeAll(async () => {
  testEnv = await initializeTestEnvironment({
    projectId: 'demo-cookbook',
    firestore: { rules: readFileSync(RULES, 'utf8') },
  });
});

afterAll(async () => {
  await testEnv?.cleanup();
});

beforeEach(async () => {
  await testEnv.clearFirestore();
  await testEnv.withSecurityRulesDisabled(async (ctx) => {
    const admin = ctx.firestore();
    await setDoc(doc(admin, 'users', AUTHOR), { role: 'approved' });
    await setDoc(doc(admin, 'users', OTHER), { role: 'approved' });
    await setDoc(doc(admin, 'users', USER), { role: 'user' });
    await setDoc(doc(admin, 'users', MANAGER), { role: 'manager' });
    await setDoc(doc(admin, 'recipes', 'published'), published);
    await setDoc(doc(admin, 'recipes', 'pending'), pending);
    await setDoc(doc(admin, 'recipes', 'legacy'), legacy);
    await setDoc(doc(admin, 'recipe_submissions', 'pending'), submission('pending', AUTHOR));
  });
});

describe('reading recipes', () => {
  test('anyone, signed out included, can read a published recipe', async () => {
    await assertSucceeds(getDoc(doc(db(null), 'recipes', 'published')));
    await assertSucceeds(getDoc(doc(db(null), 'recipes', 'legacy')));
  });

  test('a recipe that does not exist reads as missing, not as permission denied', async () => {
    const snap = await assertSucceeds(getDoc(doc(db(null), 'recipes', 'no-such-recipe')));
    expect(snap.exists()).toBe(false);
  });

  test('a private recipe is hidden from signed-out visitors and other users', async () => {
    await assertFails(getDoc(doc(db(null), 'recipes', 'pending')));
    await assertFails(getDoc(doc(db(OTHER), 'recipes', 'pending')));
  });

  test('the author and managers can read a private recipe', async () => {
    await assertSucceeds(getDoc(doc(db(AUTHOR), 'recipes', 'pending')));
    await assertSucceeds(getDoc(doc(db(MANAGER), 'recipes', 'pending')));
  });

  test('a list filtered to published recipes works for everyone', async () => {
    const q = (uid) =>
      query(collection(db(uid), 'recipes'), where('visibility', '==', 'published'));
    await assertSucceeds(getDocs(q(null)));
    await assertSucceeds(getDocs(q(OTHER)));
  });

  test('the legacy approved filter still works (older open tabs)', async () => {
    await assertSucceeds(
      getDocs(query(collection(db(null), 'recipes'), where('approved', '==', true))),
    );
  });

  test('an unfiltered list is rejected for non-managers', async () => {
    await assertFails(getDocs(collection(db(null), 'recipes')));
    await assertFails(getDocs(collection(db(OTHER), 'recipes')));
  });

  test('an author can list their own private recipes (My recipes), by stage too', async () => {
    const mine = (extra = []) =>
      query(
        collection(db(AUTHOR), 'recipes'),
        where('authorId', '==', AUTHOR),
        where('visibility', '==', 'private'),
        ...extra,
      );
    const snap = await assertSucceeds(getDocs(mine()));
    expect(snap.docs.map((d) => d.id)).toEqual(['pending']);
    await assertSucceeds(getDocs(mine([where('stage', '==', 'to-try')])));
  });

  test('nobody can list someone else’s private recipes', async () => {
    const q = query(
      collection(db(OTHER), 'recipes'),
      where('authorId', '==', AUTHOR),
      where('visibility', '==', 'private'),
    );
    await assertFails(getDocs(q));
  });

  test('a manager can list private recipes', async () => {
    const q = query(collection(db(MANAGER), 'recipes'), where('visibility', '==', 'private'));
    await assertSucceeds(getDocs(q));
  });
});

describe('creating recipes', () => {
  test('approved family can keep a private recipe without submitting it (My recipes)', async () => {
    await assertSucceeds(setDoc(doc(db(OTHER), 'recipes', 'new'), newPrivate(OTHER)));
    await assertSucceeds(
      setDoc(doc(db(OTHER), 'recipes', 'try'), { ...newPrivate(OTHER), stage: 'to-try' }),
    );
  });

  test('a plain user can only create a recipe submitted in the same batch', async () => {
    const user = db(USER);
    await assertFails(setDoc(doc(user, 'recipes', 'new2'), newPrivate(USER)));

    const batch = writeBatch(user);
    batch.set(doc(user, 'recipes', 'new3'), newPrivate(USER));
    batch.set(doc(user, 'recipe_submissions', 'new3'), submission('new3', USER));
    await assertSucceeds(batch.commit());
  });

  test('a plain user cannot pass with someone else’s submission', async () => {
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(doc(ctx.firestore(), 'recipe_submissions', 'taken'), submission('taken', OTHER));
    });
    await assertFails(setDoc(doc(db(USER), 'recipes', 'taken'), newPrivate(USER)));
  });

  test('a non-manager cannot create a published recipe', async () => {
    await assertFails(
      setDoc(doc(db(OTHER), 'recipes', 'new'), { name: 'New', ...shape(OTHER, 'published') }),
    );
  });

  test('a non-manager cannot create a recipe in someone else’s name', async () => {
    await assertFails(setDoc(doc(db(OTHER), 'recipes', 'new'), newPrivate(AUTHOR)));
  });

  test('approved and visibility must agree', async () => {
    await assertFails(
      setDoc(doc(db(OTHER), 'recipes', 'new'), { ...newPrivate(OTHER), approved: true }),
    );
  });

  test('stage must be to-try or tested', async () => {
    await assertFails(
      setDoc(doc(db(OTHER), 'recipes', 'new'), { ...newPrivate(OTHER), stage: 'draft' }),
    );
  });

  test('a non-manager cannot create a recipe claiming to be a published copy', async () => {
    await assertFails(
      setDoc(doc(db(OTHER), 'recipes', 'new'), { ...newPrivate(OTHER), sourceRecipeId: 'x' }),
    );
  });

  test('signed-out visitors cannot create recipes', async () => {
    await assertFails(setDoc(doc(db(null), 'recipes', 'new'), newPrivate(null)));
  });

  test('a manager can create a published recipe', async () => {
    await assertSucceeds(
      setDoc(doc(db(MANAGER), 'recipes', 'new'), { name: 'New', ...shape(MANAGER, 'published') }),
    );
  });
});

describe('updating recipes', () => {
  test('the author cannot publish their own recipe', async () => {
    await assertFails(
      updateDoc(doc(db(AUTHOR), 'recipes', 'pending'), {
        visibility: 'published',
        approved: true,
      }),
    );
  });

  test('the author can edit their own private recipe', async () => {
    await assertSucceeds(updateDoc(doc(db(AUTHOR), 'recipes', 'pending'), { name: 'Kubbeh!' }));
    await assertSucceeds(updateDoc(doc(db(AUTHOR), 'recipes', 'pending'), { stage: 'to-try' }));
  });

  test('the author cannot hand their recipe to someone else', async () => {
    await assertFails(updateDoc(doc(db(AUTHOR), 'recipes', 'pending'), { authorId: OTHER }));
    await assertFails(updateDoc(doc(db(AUTHOR), 'recipes', 'pending'), { userId: OTHER }));
  });

  test('the author cannot edit their published recipe directly (suggest an edit instead)', async () => {
    await assertFails(updateDoc(doc(db(AUTHOR), 'recipes', 'published'), { name: 'Changed' }));
  });

  test('another user cannot edit someone else’s recipe', async () => {
    await assertFails(updateDoc(doc(db(OTHER), 'recipes', 'pending'), { name: 'Changed' }));
    await assertFails(updateDoc(doc(db(OTHER), 'recipes', 'published'), { name: 'Changed' }));
  });

  test('nobody owns a recipe with no recorded author', async () => {
    await assertFails(updateDoc(doc(db(OTHER), 'recipes', 'legacy'), { name: 'Mine now' }));
  });

  test('another user cannot add pending images to someone else’s recipe (retired flow)', async () => {
    await assertFails(
      updateDoc(doc(db(OTHER), 'recipes', 'published'), {
        pendingImages: [{ id: 'img-1', full: 'img/recipes/full/breads/published/x.jpg' }],
      }),
    );
  });

  test('a manager can publish and edit any recipe', async () => {
    await assertSucceeds(
      updateDoc(doc(db(MANAGER), 'recipes', 'pending'), {
        visibility: 'published',
        approved: true,
      }),
    );
    await assertSucceeds(updateDoc(doc(db(MANAGER), 'recipes', 'legacy'), { name: 'Renamed' }));
  });

  test('even a manager cannot leave approved and visibility disagreeing', async () => {
    await assertFails(updateDoc(doc(db(MANAGER), 'recipes', 'pending'), { approved: true }));
  });
});

describe('deleting recipes', () => {
  test('an author can delete their own private recipe', async () => {
    await assertSucceeds(deleteDoc(doc(db(AUTHOR), 'recipes', 'pending')));
  });

  test('nobody else can delete a private recipe; published recipes are manager-only', async () => {
    await assertFails(deleteDoc(doc(db(OTHER), 'recipes', 'pending')));
    await assertFails(deleteDoc(doc(db(AUTHOR), 'recipes', 'published')));
    await assertFails(deleteDoc(doc(db(OTHER), 'recipes', 'published')));
    await assertSucceeds(deleteDoc(doc(db(MANAGER), 'recipes', 'published')));
  });

  test('on their published recipe, the author may change only the stage', async () => {
    const ref = (uid) => doc(db(uid), 'recipes', 'published');
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      await updateDoc(doc(ctx.firestore(), 'recipes', 'published'), { stage: 'to-try' });
    });
    await assertSucceeds(updateDoc(ref(AUTHOR), { stage: 'tested', testedAt: new Date() }));
    await assertFails(updateDoc(ref(AUTHOR), { name: 'renamed' }));
    await assertFails(updateDoc(ref(AUTHOR), { stage: 'to-try', name: 'renamed' }));
    await assertFails(updateDoc(ref(OTHER), { stage: 'to-try' }));
  });

  test('an author can mark their own to-try recipe tested', async () => {
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      await updateDoc(doc(ctx.firestore(), 'recipes', 'pending'), { stage: 'to-try' });
    });
    await assertSucceeds(
      updateDoc(doc(db(AUTHOR), 'recipes', 'pending'), { stage: 'tested', testedAt: new Date() }),
    );
    await assertFails(updateDoc(doc(db(OTHER), 'recipes', 'pending'), { stage: 'tested' }));
  });
});

describe('recipe submissions', () => {
  test('an author can submit their own private recipe', async () => {
    const author = db(OTHER);
    await assertSucceeds(setDoc(doc(author, 'recipes', 'mine'), newPrivate(OTHER)));
    await assertSucceeds(
      setDoc(doc(author, 'recipe_submissions', 'mine'), submission('mine', OTHER)),
    );
  });

  test('a recipe and its submission can be written in one batch', async () => {
    const author = db(USER);
    const batch = writeBatch(author);
    batch.set(doc(author, 'recipes', 'mine'), newPrivate(USER));
    batch.set(doc(author, 'recipe_submissions', 'mine'), submission('mine', USER));
    await assertSucceeds(batch.commit());
  });

  test('nobody can submit someone else’s recipe', async () => {
    await assertFails(
      setDoc(doc(db(OTHER), 'recipe_submissions', 'published'), submission('published', OTHER)),
    );
    await testEnv.withSecurityRulesDisabled((ctx) =>
      deleteDoc(doc(ctx.firestore(), 'recipe_submissions', 'pending')),
    );
    await assertFails(
      setDoc(doc(db(OTHER), 'recipe_submissions', 'pending'), submission('pending', OTHER)),
    );
  });

  test('a submission must start pending and match its document id', async () => {
    const author = db(OTHER);
    await setDoc(doc(author, 'recipes', 'mine'), newPrivate(OTHER));
    await assertFails(
      setDoc(
        doc(author, 'recipe_submissions', 'mine'),
        submission('mine', OTHER, { status: 'approved' }),
      ),
    );
    await assertFails(
      setDoc(doc(author, 'recipe_submissions', 'mine'), submission('other-id', OTHER)),
    );
  });

  test('only managers can change a submission’s status', async () => {
    await assertFails(
      updateDoc(doc(db(AUTHOR), 'recipe_submissions', 'pending'), { status: 'approved' }),
    );
    await assertSucceeds(
      updateDoc(doc(db(MANAGER), 'recipe_submissions', 'pending'), { status: 'approved' }),
    );
  });

  test('the author and managers can read a submission; others cannot', async () => {
    await assertSucceeds(getDoc(doc(db(AUTHOR), 'recipe_submissions', 'pending')));
    await assertSucceeds(getDoc(doc(db(MANAGER), 'recipe_submissions', 'pending')));
    await assertFails(getDoc(doc(db(OTHER), 'recipe_submissions', 'pending')));
    await assertFails(getDoc(doc(db(null), 'recipe_submissions', 'pending')));
  });

  test('managers can list the pending queue; others cannot', async () => {
    const q = (uid) =>
      query(collection(db(uid), 'recipe_submissions'), where('status', '==', 'pending'));
    await assertSucceeds(getDocs(q(MANAGER)));
    await assertFails(getDocs(q(OTHER)));
  });

  test('the author can withdraw a pending submission', async () => {
    await assertFails(deleteDoc(doc(db(OTHER), 'recipe_submissions', 'pending')));
    await assertSucceeds(deleteDoc(doc(db(AUTHOR), 'recipe_submissions', 'pending')));
  });

  test('a rejection must carry a note', async () => {
    const ref = (uid) => doc(db(uid), 'recipe_submissions', 'pending');
    await assertFails(updateDoc(ref(MANAGER), { status: 'rejected' }));
    await assertFails(updateDoc(ref(MANAGER), { status: 'rejected', rejectionReason: '' }));
    await assertSucceeds(
      updateDoc(ref(MANAGER), { status: 'rejected', rejectionReason: 'חסרות כמויות' }),
    );
  });

  describe('after a rejection', () => {
    beforeEach(async () => {
      await testEnv.withSecurityRulesDisabled(async (ctx) => {
        await updateDoc(doc(ctx.firestore(), 'recipe_submissions', 'pending'), {
          status: 'rejected',
          rejectionReason: 'חסרות כמויות',
          reviewedBy: MANAGER,
        });
      });
    });
    const ref = (uid) => doc(db(uid), 'recipe_submissions', 'pending');

    test('the author can resubmit: back to pending, marked as a resubmission', async () => {
      await assertSucceeds(
        updateDoc(ref(AUTHOR), { status: 'pending', resubmittedAt: serverTimestamp() }),
      );
    });

    test('a resubmission can change nothing else (no self-approval, no erasing the note)', async () => {
      await assertFails(updateDoc(ref(AUTHOR), { status: 'approved' }));
      await assertFails(updateDoc(ref(AUTHOR), { status: 'pending' })); // must be marked
      await assertFails(
        updateDoc(ref(AUTHOR), {
          status: 'pending',
          resubmittedAt: serverTimestamp(),
          rejectionReason: null,
        }),
      );
      await assertFails(
        updateDoc(ref(OTHER), { status: 'pending', resubmittedAt: serverTimestamp() }),
      );
    });

    test('the author can remove a rejected submission', async () => {
      await assertFails(deleteDoc(ref(OTHER)));
      await assertSucceeds(deleteDoc(ref(AUTHOR)));
    });
  });

  test('an approved submission stays: the author cannot delete or reopen it', async () => {
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      await updateDoc(doc(ctx.firestore(), 'recipe_submissions', 'pending'), {
        status: 'approved',
      });
    });
    const ref = doc(db(AUTHOR), 'recipe_submissions', 'pending');
    await assertFails(deleteDoc(ref));
    await assertFails(updateDoc(ref, { status: 'pending', resubmittedAt: serverTimestamp() }));
  });
});
