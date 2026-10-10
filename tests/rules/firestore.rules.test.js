/**
 * Firestore security rules — recipes.
 *
 * Runs against the emulator via `npm run test:rules`. Set FIRESTORE_RULES to a
 * different rules file to compare (e.g. the previous release's rules).
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
} from 'firebase/firestore';

const RULES = process.env.FIRESTORE_RULES || 'firestore.rules';

let testEnv;

const AUTHOR = 'author-uid';
const OTHER = 'other-uid';
const MANAGER = 'manager-uid';

const published = { name: 'Challah', userId: AUTHOR, approved: true, category: 'breads' };
const pending = { name: 'Kubbeh', userId: AUTHOR, approved: false, category: 'soups' };
const legacy = { name: 'Old recipe', approved: true, category: 'mains' }; // no userId field

const db = (uid) =>
  uid
    ? testEnv.authenticatedContext(uid).firestore()
    : testEnv.unauthenticatedContext().firestore();

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
    await setDoc(doc(admin, 'users', MANAGER), { role: 'manager' });
    await setDoc(doc(admin, 'recipes', 'published'), published);
    await setDoc(doc(admin, 'recipes', 'pending'), pending);
    await setDoc(doc(admin, 'recipes', 'legacy'), legacy);
  });
});

describe('reading recipes', () => {
  test('anyone, signed out included, can read a published recipe', async () => {
    await assertSucceeds(getDoc(doc(db(null), 'recipes', 'published')));
    await assertSucceeds(getDoc(doc(db(null), 'recipes', 'legacy')));
  });

  test('signed-out visitors cannot read an unapproved recipe', async () => {
    await assertFails(getDoc(doc(db(null), 'recipes', 'pending')));
  });

  test('another user cannot read an unapproved recipe', async () => {
    await assertFails(getDoc(doc(db(OTHER), 'recipes', 'pending')));
  });

  test('the author can read their own unapproved recipe', async () => {
    await assertSucceeds(getDoc(doc(db(AUTHOR), 'recipes', 'pending')));
  });

  test('a manager can read an unapproved recipe', async () => {
    await assertSucceeds(getDoc(doc(db(MANAGER), 'recipes', 'pending')));
  });

  test('a list filtered to approved recipes works for everyone', async () => {
    const q = (uid) => query(collection(db(uid), 'recipes'), where('approved', '==', true));
    await assertSucceeds(getDocs(q(null)));
    await assertSucceeds(getDocs(q(OTHER)));
  });

  test('an unfiltered list is rejected for non-managers', async () => {
    await assertFails(getDocs(collection(db(null), 'recipes')));
    await assertFails(getDocs(collection(db(OTHER), 'recipes')));
  });

  test('a manager can list unapproved recipes', async () => {
    const q = query(collection(db(MANAGER), 'recipes'), where('approved', '==', false));
    await assertSucceeds(getDocs(q));
  });
});

describe('creating recipes', () => {
  test('a signed-in user can propose a recipe as themselves, unapproved', async () => {
    await assertSucceeds(
      setDoc(doc(db(OTHER), 'recipes', 'new'), { name: 'New', userId: OTHER, approved: false }),
    );
  });

  test('a non-manager cannot create an already-approved recipe', async () => {
    await assertFails(
      setDoc(doc(db(OTHER), 'recipes', 'new'), { name: 'New', userId: OTHER, approved: true }),
    );
  });

  test('a non-manager cannot create a recipe in someone else’s name', async () => {
    await assertFails(
      setDoc(doc(db(OTHER), 'recipes', 'new'), { name: 'New', userId: AUTHOR, approved: false }),
    );
  });

  test('signed-out visitors cannot create recipes', async () => {
    await assertFails(
      setDoc(doc(db(null), 'recipes', 'new'), { name: 'New', userId: null, approved: false }),
    );
  });

  test('a manager can create an approved recipe', async () => {
    await assertSucceeds(
      setDoc(doc(db(MANAGER), 'recipes', 'new'), { name: 'New', userId: MANAGER, approved: true }),
    );
  });
});

describe('updating recipes', () => {
  test('the author cannot approve their own recipe', async () => {
    await assertFails(updateDoc(doc(db(AUTHOR), 'recipes', 'pending'), { approved: true }));
  });

  test('the author can edit their own unapproved recipe', async () => {
    await assertSucceeds(updateDoc(doc(db(AUTHOR), 'recipes', 'pending'), { name: 'Kubbeh!' }));
  });

  test('the author cannot hand their unapproved recipe to someone else', async () => {
    await assertFails(updateDoc(doc(db(AUTHOR), 'recipes', 'pending'), { userId: OTHER }));
  });

  test('the author cannot edit their published recipe directly (suggest an edit instead)', async () => {
    await assertFails(updateDoc(doc(db(AUTHOR), 'recipes', 'published'), { name: 'Changed' }));
  });

  test('another user cannot edit someone else’s recipe', async () => {
    await assertFails(updateDoc(doc(db(OTHER), 'recipes', 'pending'), { name: 'Changed' }));
    await assertFails(updateDoc(doc(db(OTHER), 'recipes', 'published'), { name: 'Changed' }));
  });

  test('another user cannot add pending images to someone else’s recipe (retired flow)', async () => {
    await assertFails(
      updateDoc(doc(db(OTHER), 'recipes', 'published'), {
        pendingImages: [{ id: 'img-1', full: 'img/recipes/full/breads/published/x.jpg' }],
      }),
    );
  });

  test('a manager can approve and edit any recipe', async () => {
    await assertSucceeds(updateDoc(doc(db(MANAGER), 'recipes', 'pending'), { approved: true }));
    await assertSucceeds(updateDoc(doc(db(MANAGER), 'recipes', 'legacy'), { name: 'Renamed' }));
  });
});

describe('deleting recipes', () => {
  test('only managers can delete recipes', async () => {
    await assertFails(deleteDoc(doc(db(AUTHOR), 'recipes', 'pending')));
    await assertFails(deleteDoc(doc(db(OTHER), 'recipes', 'published')));
    await assertSucceeds(deleteDoc(doc(db(MANAGER), 'recipes', 'pending')));
  });
});
