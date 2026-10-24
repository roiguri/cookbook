/**
 * Shared setup for the Cloud Functions integration tests (`npm run test:functions`):
 * real users signed up in the Auth emulator, Firestore/Storage seeded with rules off,
 * and callables / HTTP functions called like a real client would.
 */
import { readFileSync } from 'node:fs';
import { initializeTestEnvironment } from '@firebase/rules-unit-testing';
import { initializeApp, deleteApp } from 'firebase/app';
import { getAuth, connectAuthEmulator, createUserWithEmailAndPassword } from 'firebase/auth';
import { getFunctions, connectFunctionsEmulator, httpsCallable } from 'firebase/functions';

export const PROJECT = 'demo-cookbook';
// The bucket the functions see (FIREBASE_CONFIG in the emulator).
export const BUCKET = `gs://${PROJECT}.appspot.com`;

// Ports as the running emulators were started (emulators:exec sets the Auth host;
// the rest come from firebase.json).
const EMULATORS = JSON.parse(readFileSync('firebase.json', 'utf8')).emulators;
export const EMULATOR = {
  auth: process.env.FIREBASE_AUTH_EMULATOR_HOST || `127.0.0.1:${EMULATORS.auth.port}`,
  functions: EMULATORS.functions.port,
};
export const FUNCTIONS_URL = `http://127.0.0.1:${EMULATOR.functions}/${PROJECT}/us-central1`;
const ADMIN = { Authorization: 'Bearer owner', 'Content-Type': 'application/json' };
const authApi = (path) => `http://${EMULATOR.auth}/identitytoolkit.googleapis.com/v1/${path}`;

/**
 * Start a test context. Call in beforeAll; `close()` in afterAll.
 * @param {Record<string, string>} roles - name → role, e.g. { manager: 'manager' }.
 */
export async function startContext(roles) {
  const testEnv = await initializeTestEnvironment({
    projectId: PROJECT,
    firestore: { rules: readFileSync('firestore.rules', 'utf8') },
    storage: { rules: readFileSync('storage.rules', 'utf8') },
  });
  await fetch(`http://${EMULATOR.auth}/emulator/v1/projects/${PROJECT}/accounts`, {
    method: 'DELETE',
  });

  const apps = [];
  const uid = {};
  const call = {};
  let n = 0;
  async function signUp(name) {
    const app = initializeApp({ apiKey: 'demo', projectId: PROJECT }, `fn-test-${++n}-${name}`);
    apps.push(app);
    const auth = getAuth(app);
    connectAuthEmulator(auth, `http://${EMULATOR.auth}`, { disableWarnings: true });
    const fns = getFunctions(app);
    connectFunctionsEmulator(fns, '127.0.0.1', EMULATOR.functions);
    const { user } = await createUserWithEmailAndPassword(auth, `${name}@example.test`, 'password');
    uid[name] = user.uid;
    call[name] = (fnName, data) => httpsCallable(fns, fnName)(data).then((r) => r.data);
  }
  for (const name of Object.keys(roles)) await signUp(name);

  /** Run `fn(firestore, storage)` with rules off; resolves to its result. */
  async function asAdmin(fn) {
    let result;
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      result = await fn(ctx.firestore(), ctx.storage(BUCKET));
    });
    return result;
  }

  return {
    testEnv,
    uid,
    call,
    asAdmin,
    /** Clear Firestore and give every user their role again. Call in beforeEach. */
    async reset() {
      await testEnv.clearFirestore();
      await asAdmin(async (db) => {
        const { doc, setDoc } = await import('firebase/firestore');
        await Promise.all(
          Object.entries(roles).map(([name, role]) =>
            setDoc(doc(db, 'users', uid[name]), { role, fullName: `${name} user` }),
          ),
        );
      });
    },
    /** Sign up one more user with a role (e.g. one a test will delete). */
    async addUser(name, role) {
      await signUp(name);
      await asAdmin(async (db) => {
        const { doc, setDoc } = await import('firebase/firestore');
        await setDoc(doc(db, 'users', uid[name]), { role, fullName: `${name} user` });
      });
      return uid[name];
    },
    /** Auth emulator admin calls. */
    authAdmin: {
      async delete(localId) {
        await fetch(authApi(`projects/${PROJECT}/accounts:delete`), {
          method: 'POST',
          headers: ADMIN,
          body: JSON.stringify({ localId }),
        });
      },
      async setDisabled(localId, disabled) {
        await fetch(authApi(`projects/${PROJECT}/accounts:update`), {
          method: 'POST',
          headers: ADMIN,
          body: JSON.stringify({ localId, disableUser: disabled }),
        });
      },
      async exists(localId) {
        const res = await fetch(authApi(`projects/${PROJECT}/accounts:lookup`), {
          method: 'POST',
          headers: ADMIN,
          body: JSON.stringify({ localId: [localId] }),
        });
        const body = await res.json();
        return Array.isArray(body.users) && body.users.length > 0;
      },
    },
    async close() {
      await Promise.all(apps.map((app) => deleteApp(app)));
      await testEnv.cleanup();
    },
  };
}

export const rejectsWith = (promise, code) =>
  expect(promise).rejects.toMatchObject({ code: `functions/${code}` });
