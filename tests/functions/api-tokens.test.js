/**
 * Recipe-API token callables (createApiToken / listApiTokens / revokeApiToken) against
 * the real functions in the Functions emulator. Run with `npm run test:functions`.
 * Plan: docs/feature-plans/recipe-api.md, slice 2.
 */
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { initializeTestEnvironment } from '@firebase/rules-unit-testing';
import { initializeApp, deleteApp } from 'firebase/app';
import { getAuth, connectAuthEmulator, createUserWithEmailAndPassword } from 'firebase/auth';
import { getFunctions, connectFunctionsEmulator, httpsCallable } from 'firebase/functions';
import { doc, getDoc, setDoc, collection, query, where, getDocs } from 'firebase/firestore';

const PROJECT = 'demo-cookbook';
// Ports as the running emulators were started (emulators:exec sets the Auth host;
// the Functions port comes from firebase.json).
const EMULATORS = JSON.parse(readFileSync('firebase.json', 'utf8')).emulators;
const EMULATOR = {
  auth: process.env.FIREBASE_AUTH_EMULATOR_HOST || `127.0.0.1:${EMULATORS.auth.port}`,
  functions: EMULATORS.functions.port,
};

// Test users by role; their real uids come from signing up in the Auth emulator.
const ROLES = { manager: 'manager', approved: 'approved', approved2: 'approved', plain: 'user' };
const uid = {};
const call = {};

let testEnv;
const sessions = [];

/** Seed / inspect Firestore as the Admin SDK would (rules off); resolves to fn's result. */
async function asAdmin(fn) {
  let result;
  await testEnv.withSecurityRulesDisabled(async (ctx) => {
    result = await fn(ctx.firestore());
  });
  return result;
}
const tokenDoc = (tokenId) => asAdmin((db) => getDoc(doc(db, 'api_tokens', tokenId)));
const tokensOf = (owner) =>
  asAdmin((db) => getDocs(query(collection(db, 'api_tokens'), where('uid', '==', owner))));

async function signUp(name) {
  const app = initializeApp({ apiKey: 'demo', projectId: PROJECT }, `functions-test-${name}`);
  sessions.push(app);
  const auth = getAuth(app);
  connectAuthEmulator(auth, `http://${EMULATOR.auth}`, { disableWarnings: true });
  const fns = getFunctions(app);
  connectFunctionsEmulator(fns, '127.0.0.1', EMULATOR.functions);
  const { user } = await createUserWithEmailAndPassword(auth, `${name}@example.test`, 'password');
  uid[name] = user.uid;
  call[name] = (fnName, data) => httpsCallable(fns, fnName)(data).then((r) => r.data);
}

const rejectsWith = (promise, code) =>
  expect(promise).rejects.toMatchObject({ code: `functions/${code}` });

beforeAll(async () => {
  testEnv = await initializeTestEnvironment({
    projectId: PROJECT,
    firestore: { rules: readFileSync('firestore.rules', 'utf8') },
  });
  await fetch(`http://${EMULATOR.auth}/emulator/v1/projects/${PROJECT}/accounts`, {
    method: 'DELETE',
  });
  for (const name of Object.keys(ROLES)) await signUp(name);
});

beforeEach(async () => {
  await testEnv.clearFirestore();
  await asAdmin((db) =>
    Promise.all(
      Object.entries(ROLES).map(([name, role]) => setDoc(doc(db, 'users', uid[name]), { role })),
    ),
  );
});

afterAll(async () => {
  await Promise.all(sessions.map((app) => deleteApp(app)));
  await testEnv?.cleanup();
});

describe('createApiToken', () => {
  it('returns the secret once and stores only its hash', async () => {
    const created = await call.manager('createApiToken', {
      uid: uid.approved,
      name: ' Jarvis ',
      scope: 'read+write',
    });
    expect(created.token).toMatch(/^ckb_[A-Za-z0-9_-]{43}$/);
    expect(created).toMatchObject({
      uid: uid.approved,
      name: 'Jarvis',
      scope: 'read+write',
      createdBy: uid.manager,
    });
    expect(created.prefix).toBe(created.token.slice(0, 8));

    const stored = (await tokenDoc(created.tokenId)).data();
    expect(JSON.stringify(stored)).not.toContain(created.token);
    // Exactly the token's SHA-256 — what the API will look tokens up by.
    expect(stored.hash).toBe(createHash('sha256').update(created.token).digest('hex'));
  });

  it('can issue a token to a manager, themselves included', async () => {
    await expect(
      call.manager('createApiToken', { uid: uid.manager, name: 'Mine', scope: 'read' }),
    ).resolves.toHaveProperty('token');
  });

  it('refuses plain users and unknown users', async () => {
    await rejectsWith(
      call.manager('createApiToken', { uid: uid.plain, name: 'x', scope: 'read' }),
      'failed-precondition',
    );
    await rejectsWith(
      call.manager('createApiToken', { uid: 'nobody', name: 'x', scope: 'read' }),
      'failed-precondition',
    );
  });

  it('rejects invalid input', async () => {
    await rejectsWith(
      call.manager('createApiToken', { uid: uid.approved, name: 'x', scope: 'admin' }),
      'invalid-argument',
    );
    await rejectsWith(
      call.manager('createApiToken', { uid: `users/${uid.approved}`, name: 'x', scope: 'read' }),
      'invalid-argument',
    );
    await rejectsWith(
      call.manager('createApiToken', { uid: uid.approved, name: '  ', scope: 'read' }),
      'invalid-argument',
    );
  });

  it('allows 3 tokens per user and refuses the 4th', async () => {
    for (const name of ['one', 'two', 'three']) {
      await call.manager('createApiToken', { uid: uid.approved, name, scope: 'read' });
    }
    await rejectsWith(
      call.manager('createApiToken', { uid: uid.approved, name: 'four', scope: 'read' }),
      'resource-exhausted',
    );
    // Another user's cap is separate.
    await expect(
      call.manager('createApiToken', { uid: uid.approved2, name: 'one', scope: 'read' }),
    ).resolves.toBeTruthy();
  });

  it('holds the cap under concurrent creates', async () => {
    const settled = await Promise.allSettled(
      Array.from({ length: 6 }, (_, i) =>
        call.manager('createApiToken', { uid: uid.approved2, name: `c${i}`, scope: 'read' }),
      ),
    );
    expect(settled.filter((s) => s.status === 'fulfilled')).toHaveLength(3);
    const stored = await tokensOf(uid.approved2);
    expect(stored.size).toBe(3);
  });
});

describe('listApiTokens', () => {
  it('returns metadata and the cap, never the hash or the secret', async () => {
    const created = await call.manager('createApiToken', {
      uid: uid.approved,
      name: 'Jarvis',
      scope: 'read',
    });
    const { tokens, maxPerUser } = await call.manager('listApiTokens');
    expect(maxPerUser).toBe(3);
    expect(tokens).toEqual([
      expect.objectContaining({
        tokenId: created.tokenId,
        uid: uid.approved,
        name: 'Jarvis',
        lastUsedAt: null,
      }),
    ]);
    expect(JSON.stringify(tokens)).not.toMatch(/hash|ckb_[A-Za-z0-9_-]{43}/);
  });
});

describe('revokeApiToken', () => {
  it('deletes the token; revoking again is a no-op', async () => {
    const created = await call.manager('createApiToken', {
      uid: uid.approved,
      name: 'Jarvis',
      scope: 'read',
    });
    await call.manager('revokeApiToken', { tokenId: created.tokenId });
    expect((await tokenDoc(created.tokenId)).exists()).toBe(false);
    await expect(
      call.manager('revokeApiToken', { tokenId: created.tokenId }),
    ).resolves.toBeTruthy();
  });

  it('rejects a token id that is a path', async () => {
    await rejectsWith(call.manager('revokeApiToken', { tokenId: 'a/b' }), 'invalid-argument');
  });
});

describe('only managers', () => {
  it('a caller who is not signed in is refused', async () => {
    const app = initializeApp({ apiKey: 'demo', projectId: PROJECT }, 'functions-test-anon');
    sessions.push(app);
    const fns = getFunctions(app);
    connectFunctionsEmulator(fns, '127.0.0.1', EMULATOR.functions);
    await rejectsWith(httpsCallable(fns, 'listApiTokens')(), 'unauthenticated');
    await rejectsWith(
      httpsCallable(fns, 'createApiToken')({ uid: uid.approved, name: 'x', scope: 'read' }),
      'unauthenticated',
    );
  });

  it('approved users cannot create, list or revoke', async () => {
    const created = await call.manager('createApiToken', {
      uid: uid.approved,
      name: 'Jarvis',
      scope: 'read',
    });
    await rejectsWith(
      call.approved('createApiToken', { uid: uid.approved, name: 'x', scope: 'read' }),
      'permission-denied',
    );
    await rejectsWith(call.approved('listApiTokens'), 'permission-denied');
    await rejectsWith(
      call.approved('revokeApiToken', { tokenId: created.tokenId }),
      'permission-denied',
    );
    expect((await tokenDoc(created.tokenId)).exists()).toBe(true);
  });

  it('a manager demoted to approved loses access at once', async () => {
    await asAdmin((db) => setDoc(doc(db, 'users', uid.manager), { role: 'approved' }));
    await rejectsWith(call.manager('listApiTokens'), 'permission-denied');
  });
});
