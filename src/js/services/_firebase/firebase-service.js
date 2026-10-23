// src/js/services/firebase-service.js

// Import Firebase SDK modules (v9+ modular)
import { initializeApp, getApps } from 'firebase/app';
import { initializeAuth, browserLocalPersistence, connectAuthEmulator } from 'firebase/auth';
import { getFirestore, connectFirestoreEmulator } from 'firebase/firestore';
import { getStorage, connectStorageEmulator } from 'firebase/storage';

let firebaseApp = null;
let firebaseAuth = null;
let firebaseFirestore = null;
let firebaseStorage = null;

/**
 * Initializes Firebase app and services (singleton).
 * @param {object} config - Firebase config object
 */
export function initFirebase(config) {
  if (!firebaseApp) {
    // Only initialize if not already initialized
    if (!getApps().length) {
      firebaseApp = initializeApp(config);
    } else {
      firebaseApp = getApps()[0];
    }
    firebaseAuth = initializeAuth(firebaseApp, { persistence: browserLocalPersistence });
    firebaseFirestore = getFirestore(firebaseApp);
    firebaseStorage = getStorage(firebaseApp);
    // `npm run dev:emulators` — local Auth/Firestore/Storage/Functions emulators (ports in
    // firebase.json), on the machine that served the page, so a phone on the same network
    // works too. Services call getFunctions(app), which returns this same connected instance.
    // firebase/functions is imported lazily so production bundles don't carry it here; a
    // callable fired in the first milliseconds of an emulator session could miss the hookup.
    if (import.meta.env?.VITE_USE_EMULATORS === 'true') {
      const host = globalThis.location?.hostname || '127.0.0.1';
      connectAuthEmulator(firebaseAuth, `http://${host}:9099`, { disableWarnings: true });
      connectFirestoreEmulator(firebaseFirestore, host, 8080);
      connectStorageEmulator(firebaseStorage, host, 9199);
      import('firebase/functions').then(({ getFunctions, connectFunctionsEmulator }) =>
        connectFunctionsEmulator(getFunctions(firebaseApp), host, 5001),
      );
    }
  }
  return {
    app: firebaseApp,
    auth: firebaseAuth,
    db: firebaseFirestore,
    storage: firebaseStorage,
  };
}

/**
 * Returns the initialized Firebase app instance.
 */
export function getFirebaseApp() {
  return firebaseApp;
}

/**
 * Returns the initialized Firebase Auth instance.
 */
export function getAuthInstance() {
  return firebaseAuth;
}

/**
 * Returns the initialized Firestore instance.
 */
export function getFirestoreInstance() {
  return firebaseFirestore;
}

/**
 * Returns the initialized Firebase Storage instance.
 */
export function getStorageInstance() {
  return firebaseStorage;
}
