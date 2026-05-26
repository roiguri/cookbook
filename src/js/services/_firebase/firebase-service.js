// src/js/services/firebase-service.js

// Import Firebase SDK modules (v9+ modular)
import { initializeApp, getApps } from 'firebase/app';
import { initializeAuth, browserLocalPersistence } from 'firebase/auth';
import { getFirestore } from 'firebase/firestore';
import { getStorage } from 'firebase/storage';

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
