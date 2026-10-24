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
  collectionGroup,
  query,
  where,
  getDocs,
  writeBatch,
  serverTimestamp,
  deleteField,
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

  test('a list filtered on the legacy approved flag is rejected for non-managers', async () => {
    await assertFails(
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

  test('the legacy approved flag is ignored: it neither publishes nor blocks', async () => {
    await assertSucceeds(
      setDoc(doc(db(OTHER), 'recipes', 'new'), { ...newPrivate(OTHER), approved: true }),
    );
    // still private: another user can't read it
    await assertFails(getDoc(doc(db(AUTHOR), 'recipes', 'new')));
  });

  test('visibility must be private or published', async () => {
    await assertFails(
      setDoc(doc(db(OTHER), 'recipes', 'new'), { ...newPrivate(OTHER), visibility: 'public' }),
    );
  });

  test('stage must be to-try or tested', async () => {
    await assertFails(
      setDoc(doc(db(OTHER), 'recipes', 'new'), { ...newPrivate(OTHER), stage: 'draft' }),
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

  test('an author can move their tested recipe back to try, published or private', async () => {
    const back = { stage: 'to-try', testedAt: deleteField() };
    for (const id of ['published', 'pending']) {
      await testEnv.withSecurityRulesDisabled(async (ctx) => {
        await updateDoc(doc(ctx.firestore(), 'recipes', id), {
          stage: 'tested',
          testedAt: new Date(),
        });
      });
      await assertFails(updateDoc(doc(db(OTHER), 'recipes', id), back));
      await assertSucceeds(updateDoc(doc(db(AUTHOR), 'recipes', id), back));
    }
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

// Recipe sharing (R3, docs/archive/feature-plans/recipe-sharing.md): the author of a private
// recipe shares it with approved family through recipes/{id}/shares/{recipientUid}.
describe('recipe shares', () => {
  const FRIEND = 'friend-uid'; // approved, never shared with
  const share = (recipientUid, extra = {}) => ({
    recipientUid,
    authorId: AUTHOR,
    authorName: 'Author Name',
    sharedAt: serverTimestamp(),
    ...extra,
  });
  const shareRef = (uid, recipientUid, recipeId = 'pending') =>
    doc(db(uid), 'recipes', recipeId, 'shares', recipientUid);
  const seedShare = (recipientUid, recipeId = 'pending') =>
    testEnv.withSecurityRulesDisabled((ctx) =>
      setDoc(doc(ctx.firestore(), 'recipes', recipeId, 'shares', recipientUid), {
        recipientUid,
        authorId: AUTHOR,
        authorName: 'Author Name',
        sharedAt: new Date(),
      }),
    );

  beforeEach(async () => {
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      const admin = ctx.firestore();
      await setDoc(doc(admin, 'users', FRIEND), { role: 'approved' });
      await setDoc(doc(admin, 'recipes', 'proposal'), {
        name: 'Proposal',
        ...shape(USER, 'private'),
      });
    });
  });

  describe('sharing', () => {
    test('the author can share their private recipe with approved family and managers', async () => {
      await assertSucceeds(setDoc(shareRef(AUTHOR, OTHER), share(OTHER)));
      await assertSucceeds(setDoc(shareRef(AUTHOR, MANAGER), share(MANAGER)));
    });

    test('the recipient can then read the recipe; before that they cannot', async () => {
      await assertFails(getDoc(doc(db(OTHER), 'recipes', 'pending')));
      await setDoc(shareRef(AUTHOR, OTHER), share(OTHER));
      await assertSucceeds(getDoc(doc(db(OTHER), 'recipes', 'pending')));
      await assertFails(getDoc(doc(db(FRIEND), 'recipes', 'pending')));
    });

    test('a plain user cannot receive, and nobody can share with themselves', async () => {
      await assertFails(setDoc(shareRef(AUTHOR, USER), share(USER)));
      await assertFails(setDoc(shareRef(AUTHOR, AUTHOR), share(AUTHOR)));
    });

    test('only the author shares, and only a private recipe', async () => {
      await assertFails(setDoc(shareRef(OTHER, FRIEND), share(FRIEND, { authorId: OTHER })));
      await assertFails(setDoc(shareRef(MANAGER, FRIEND), share(FRIEND, { authorId: MANAGER })));
      await assertFails(setDoc(shareRef(AUTHOR, OTHER, 'published'), share(OTHER)));
      await assertFails(setDoc(shareRef(null, OTHER), share(OTHER)));
    });

    test('a plain user cannot share their own proposal', async () => {
      await assertFails(
        setDoc(shareRef(USER, OTHER, 'proposal'), share(OTHER, { authorId: USER })),
      );
    });

    test('the record must match its id, carry the server time and only the four fields', async () => {
      await assertFails(setDoc(shareRef(AUTHOR, OTHER), share(FRIEND)));
      await assertFails(setDoc(shareRef(AUTHOR, OTHER), share(OTHER, { sharedAt: new Date(0) })));
      await assertFails(setDoc(shareRef(AUTHOR, OTHER), share(OTHER, { canEdit: true })));
      await assertFails(setDoc(shareRef(AUTHOR, OTHER), share(OTHER, { authorName: '' })));
      const { authorName, ...noName } = share(OTHER);
      expect(authorName).toBeTruthy();
      await assertFails(setDoc(shareRef(AUTHOR, OTHER), noName));
    });

    test('a share record is never edited', async () => {
      await seedShare(OTHER);
      await assertFails(updateDoc(shareRef(AUTHOR, OTHER), { authorName: 'Someone else' }));
      await assertFails(updateDoc(shareRef(MANAGER, OTHER), { authorName: 'Someone else' }));
    });
  });

  describe('what a recipient can do', () => {
    beforeEach(() => seedShare(OTHER));

    test('read the recipe, but not edit or delete it', async () => {
      await assertSucceeds(getDoc(doc(db(OTHER), 'recipes', 'pending')));
      await assertFails(updateDoc(doc(db(OTHER), 'recipes', 'pending'), { name: 'Mine now' }));
      await assertFails(deleteDoc(doc(db(OTHER), 'recipes', 'pending')));
    });

    test('loses access once approval is taken away', async () => {
      await testEnv.withSecurityRulesDisabled((ctx) =>
        updateDoc(doc(ctx.firestore(), 'users', OTHER), { role: 'user' }),
      );
      await assertFails(getDoc(doc(db(OTHER), 'recipes', 'pending')));
    });

    test('loses access when the share is removed', async () => {
      await assertSucceeds(deleteDoc(shareRef(AUTHOR, OTHER)));
      await assertFails(getDoc(doc(db(OTHER), 'recipes', 'pending')));
    });

    test('can remove the share from their own list', async () => {
      await assertSucceeds(deleteDoc(shareRef(OTHER, OTHER)));
    });

    test('cannot list the recipe among private recipes (shares are read one by one)', async () => {
      const q = query(collection(db(OTHER), 'recipes'), where('authorId', '==', AUTHOR));
      await assertFails(getDocs(q));
    });
  });

  describe('reading share records', () => {
    beforeEach(async () => {
      await seedShare(OTHER);
      await seedShare(MANAGER);
    });

    test('the recipient lists everything shared with them across recipes', async () => {
      const q = (uid) =>
        query(collectionGroup(db(uid), 'shares'), where('recipientUid', '==', uid));
      const snap = await assertSucceeds(getDocs(q(OTHER)));
      expect(snap.docs.map((d) => d.ref.parent.parent.id)).toEqual(['pending']);
      await assertSucceeds(getDocs(q(FRIEND)));
    });

    test('nobody lists what was shared with someone else', async () => {
      const q = query(collectionGroup(db(FRIEND), 'shares'), where('recipientUid', '==', OTHER));
      await assertFails(getDocs(q));
      await assertFails(getDocs(collectionGroup(db(FRIEND), 'shares')));
    });

    test('the author lists who has access to their recipe', async () => {
      const q = query(
        collection(db(AUTHOR), 'recipes', 'pending', 'shares'),
        where('authorId', '==', AUTHOR),
      );
      const snap = await assertSucceeds(getDocs(q));
      expect(snap.size).toBe(2);
    });

    test('a recipient reads their own record, missing or not, but no one else’s', async () => {
      await assertSucceeds(getDoc(shareRef(OTHER, OTHER)));
      await assertSucceeds(getDoc(shareRef(FRIEND, FRIEND)));
      await assertFails(getDoc(shareRef(FRIEND, OTHER)));
      await assertFails(getDoc(shareRef(OTHER, MANAGER)));
    });

    test('managers can read share records', async () => {
      await assertSucceeds(getDoc(shareRef(MANAGER, OTHER)));
      await assertSucceeds(getDocs(collection(db(MANAGER), 'recipes', 'pending', 'shares')));
    });

    test('only the author, the recipient or a manager removes a share', async () => {
      await assertFails(deleteDoc(shareRef(FRIEND, OTHER)));
      await assertFails(deleteDoc(shareRef(null, OTHER)));
      await assertSucceeds(deleteDoc(shareRef(MANAGER, OTHER)));
    });

    test('the author deletes the recipe and its shares in one batch', async () => {
      const authorDb = db(AUTHOR);
      const batch = writeBatch(authorDb);
      batch.delete(doc(authorDb, 'recipes', 'pending', 'shares', OTHER));
      batch.delete(doc(authorDb, 'recipes', 'pending', 'shares', MANAGER));
      batch.delete(doc(authorDb, 'recipes', 'pending'));
      await assertSucceeds(batch.commit());
    });
  });
});

describe('user profile: avatar config', () => {
  const config = {
    v: 1,
    parts: { face: 'round', hair: 'curly', hat: 'bandana' },
    colors: { skin: 'deep', background: 'sage' },
  };
  const own = () => doc(db(USER), 'users', USER);

  test('a user can save their built avatar with its config', async () => {
    await assertSucceeds(
      updateDoc(own(), { avatarConfig: config, avatarUrl: 'https://cdn/user-avatars%2Fu.png' }),
    );
  });

  test('profile updates without an avatar config still work', async () => {
    await assertSucceeds(updateDoc(own(), { bio: 'שף ביתי' }));
  });

  test('a config with unknown keys is rejected', async () => {
    await assertFails(updateDoc(own(), { avatarConfig: { ...config, script: 'x' } }));
  });

  test('a config that is not a map, or has a non-integer version, is rejected', async () => {
    await assertFails(updateDoc(own(), { avatarConfig: 'curly' }));
    await assertFails(updateDoc(own(), { avatarConfig: { ...config, v: '1' } }));
    await assertFails(updateDoc(own(), { avatarConfig: { ...config, parts: ['curly'] } }));
  });

  test('oversized part or colour maps are rejected', async () => {
    const many = Object.fromEntries(Array.from({ length: 17 }, (_, i) => [`p${i}`, 'x']));
    await assertFails(updateDoc(own(), { avatarConfig: { ...config, parts: many } }));
    const colors = Object.fromEntries(Array.from({ length: 9 }, (_, i) => [`c${i}`, 'x']));
    await assertFails(updateDoc(own(), { avatarConfig: { ...config, colors } }));
  });

  test('the avatar config cannot be used to sneak in a role change', async () => {
    await assertFails(updateDoc(own(), { avatarConfig: config, role: 'manager' }));
  });

  test('a new profile may not carry an invalid config', async () => {
    const fresh = 'fresh-uid';
    await assertFails(
      setDoc(doc(db(fresh), 'users', fresh), { role: 'user', avatarConfig: { bad: true } }),
    );
    await assertSucceeds(setDoc(doc(db(fresh), 'users', fresh), { role: 'user' }));
  });
});

describe('recipe API tokens', () => {
  const tokenDoc = (uid) => doc(db(uid), 'api_tokens', 't1');

  beforeEach(async () => {
    await testEnv.withSecurityRulesDisabled((ctx) =>
      setDoc(doc(ctx.firestore(), 'api_tokens', 't1'), { uid: AUTHOR, hash: 'h', scope: 'read' }),
    );
  });

  test('no client can read a token — not the owner, not a manager', async () => {
    await assertFails(getDoc(tokenDoc(AUTHOR)));
    await assertFails(getDoc(tokenDoc(MANAGER)));
    await assertFails(getDoc(tokenDoc(null)));
    await assertFails(getDocs(collection(db(MANAGER), 'api_tokens')));
    await assertFails(
      getDocs(query(collection(db(AUTHOR), 'api_tokens'), where('uid', '==', AUTHOR))),
    );
  });

  test('no client can create, change or delete a token', async () => {
    await assertFails(
      setDoc(doc(db(MANAGER), 'api_tokens', 'new'), { uid: MANAGER, hash: 'h', scope: 'read' }),
    );
    await assertFails(updateDoc(tokenDoc(MANAGER), { scope: 'read+write' }));
    await assertFails(deleteDoc(tokenDoc(MANAGER)));
    await assertFails(deleteDoc(tokenDoc(AUTHOR)));
  });
});
