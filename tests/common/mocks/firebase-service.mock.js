import { jest } from '@jest/globals';

/**
 * Mock for your app's Firebase service abstraction (src/js/services/_firebase/firebase-service.js).
 *
 * Purpose: Prevents real Firebase SDK calls and allows control over your app's
 * Firebase logic in tests by mocking:
 *   - getAuthInstance, getFirestoreInstance, getStorageInstance, initFirebase
 *
 * Exports:
 *   - firebaseServiceMocks: contains mock objects for auth, Firestore, and storage
 *
 * Use this mock when your code or tests import from your own service abstraction.
 */

const authMock = {
  onAuthStateChanged: jest.fn(),
  signInWithPopup: jest.fn(),
  createUserWithEmailAndPassword: jest.fn(),
  signOut: jest.fn(),
  sendPasswordResetEmail: jest.fn(),
};
const userDocMock = {
  get: jest.fn(),
  set: jest.fn(),
  update: jest.fn(),
  delete: jest.fn(),
  exists: true,
  data: jest.fn().mockReturnValue({ role: 'user' }),
};
const userCollectionMock = {
  doc: jest.fn(() => userDocMock),
};
const dbMock = {
  collection: jest.fn(() => userCollectionMock),
};
const storageMock = {};

jest.unstable_mockModule('src/js/services/_firebase/firebase-service.js', () => ({
  getAuthInstance: jest.fn(() => authMock),
  getFirestoreInstance: jest.fn(() => dbMock),
  getStorageInstance: jest.fn(() => storageMock),
  initFirebase: jest.fn(),
}));

// Export for test files to import and execute
export const firebaseServiceMocks = {
  authMock,
  userDocMock,
  userCollectionMock,
  dbMock,
  storageMock,
};
