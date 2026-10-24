/**
 * Recipe API — acting as the user (docs/feature-plans/recipe-api.md §2, steps 4–5).
 *
 * Each request gets its own Firebase client app, signed in as the token's owner with a
 * custom token, so firestore.rules and storage.rules decide what it may do — exactly as
 * in the app. One function instance serves concurrent requests; a fresh named app per
 * request keeps their sign-ins apart. Always close the session.
 */
const crypto = require('node:crypto');
const { initializeApp, deleteApp, setLogLevel } = require('firebase/app');
const { getAuth, connectAuthEmulator, signInWithCustomToken } = require('firebase/auth');
const {
  getFirestore,
  connectFirestoreEmulator,
  setLogLevel: setFirestoreLogLevel,
} = require('firebase/firestore/lite');
const { getStorage, connectStorageEmulator } = require('firebase/storage');

// The client SDK logs failed calls with document paths and request bodies; keep recipe
// content and ids out of Cloud Logging. Each package bundles its own logger, so
// firebase/app's setLogLevel doesn't reach Firestore's: silence both. (Storage doesn't
// log; Auth logs only internal assertions.)
setLogLevel('silent');
setFirestoreLogLevel('silent');

const inEmulator = () => process.env.FUNCTIONS_EMULATOR === 'true';

// Give up on a Storage call well inside the function's timeout.
const STORAGE_RETRY_MS = 8000;

/** The client config for this project: the runtime's own project, plus the web API key. */
function clientConfig(apiKey) {
  const runtime = JSON.parse(process.env.FIREBASE_CONFIG || '{}');
  return {
    // The emulators accept any key; deployed functions need the real one.
    apiKey: apiKey || (inEmulator() ? 'demo-api-key' : ''),
    projectId: runtime.projectId || process.env.GCLOUD_PROJECT,
    storageBucket: runtime.storageBucket,
  };
}

const hostPort = (value) => {
  const [host, port] = String(value).split(':');
  return [host, Number(port)];
};

/**
 * Open a session as `uid`.
 * @param {string} uid - From the stored token record only — never from the request.
 * @param {{ auth: import('firebase-admin/auth').Auth, apiKey: string }} deps
 * @returns {Promise<{ uid: string, db: *, storage: *, close: () => Promise<void> }>}
 */
async function openUserSession(uid, { auth, apiKey }) {
  const config = clientConfig(apiKey);
  if (!config.apiKey) {
    throw Object.assign(new Error('WEB_API_KEY is not configured.'), {
      code: 'config/missing-web-api-key',
    });
  }
  const customToken = await auth.createCustomToken(uid);

  const app = initializeApp(config, `recipe-api-${crypto.randomUUID()}`);
  const close = () => deleteApp(app).catch(() => {});
  try {
    const clientAuth = getAuth(app);
    const db = getFirestore(app);
    const storage = getStorage(app);
    // The SDK retries for up to 2 minutes by default — longer than the request may run.
    storage.maxOperationRetryTime = STORAGE_RETRY_MS;
    storage.maxUploadRetryTime = STORAGE_RETRY_MS;
    if (inEmulator()) {
      const { FIREBASE_AUTH_EMULATOR_HOST, FIRESTORE_EMULATOR_HOST } = process.env;
      const storageHost = process.env.FIREBASE_STORAGE_EMULATOR_HOST;
      if (FIREBASE_AUTH_EMULATOR_HOST) {
        connectAuthEmulator(clientAuth, `http://${FIREBASE_AUTH_EMULATOR_HOST}`, {
          disableWarnings: true,
        });
      }
      if (FIRESTORE_EMULATOR_HOST)
        connectFirestoreEmulator(db, ...hostPort(FIRESTORE_EMULATOR_HOST));
      if (storageHost) connectStorageEmulator(storage, ...hostPort(storageHost));
    }
    const { user } = await signInWithCustomToken(clientAuth, customToken);
    if (user.uid !== uid) throw new Error('Signed in as the wrong user.');
    return { uid, db, storage, close };
  } catch (error) {
    await close();
    throw error;
  }
}

module.exports = { openUserSession, clientConfig };
