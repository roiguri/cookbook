import { jest } from '@jest/globals';

/**
 * Mock for 'firebase/auth'.
 *
 * Purpose: Prevents real authentication/network calls during tests by mocking:
 *   - Auth persistence constants and resolvers
 *   - Auth methods (signIn, signOut, etc.)
 *   - GoogleAuthProvider
 *   - initializeAuth: returns a dummy auth object
 *
 * Use this mock when your code or tests import from 'firebase/auth'.
 */

jest.unstable_mockModule('firebase/auth', () => ({
  browserLocalPersistence: 'local',
  connectAuthEmulator: jest.fn(),
  browserSessionPersistence: 'session',
  browserPopupRedirectResolver: 'mockResolver',
  EmailAuthProvider: { credential: jest.fn() },
  GoogleAuthProvider: jest.fn().mockImplementation(() => ({ addScope: jest.fn() })),
  setPersistence: jest.fn(),
  signInWithEmailAndPassword: jest.fn(),
  signInWithPopup: jest.fn(),
  createUserWithEmailAndPassword: jest.fn(),
  signOut: jest.fn(),
  sendPasswordResetEmail: jest.fn(),
  initializeAuth: jest.fn(() => 'mockAuth'),
  updateProfile: jest.fn(),
  updatePassword: jest.fn(),
  reauthenticateWithCredential: jest.fn(),
  linkWithPopup: jest.fn(),
  unlink: jest.fn(),
}));
