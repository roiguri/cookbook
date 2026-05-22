import { jest } from '@jest/globals';

/**
 * Mock for 'firebase/firestore'.
 *
 * Purpose: Prevents real Firestore/database calls during tests by mocking:
 *   - Firestore methods (getDoc, setDoc, updateDoc, deleteDoc, doc)
 *   - serverTimestamp
 *   - getFirestore: returns a dummy Firestore object
 *
 * Exports:
 *   - mockDocRef: a mock document reference for use in tests
 *   - firebaseService: allows tests to customize mock Firestore behavior
 *
 * Use this mock when your code or tests import from 'firebase/firestore'.
 */

// This mockDocRef can be used in tests if needed
export const mockDocRef = {};

// Allow tests to set this reference for dynamic behavior
export let firebaseService = {};

jest.unstable_mockModule('firebase/firestore', () => ({
  serverTimestamp: jest.fn(() => 'server-timestamp'),
  Timestamp: { now: jest.fn(() => 'mock-timestamp-now') },
  doc: jest.fn(() => mockDocRef),
  getDoc: jest.fn().mockImplementation(() => {
    return Promise.resolve({
      exists: () => firebaseService._mockUserDoc.exists,
      data: () => firebaseService._mockUserDoc.data(),
      id: firebaseService._mockUserDoc.id,
    });
  }),
  setDoc: jest.fn(),
  updateDoc: jest.fn(),
  deleteDoc: jest.fn(),
  // Field-value sentinels. Tests can compare against fresh `arrayUnion(x)` /
  // `arrayRemove(x)` calls since the same value+args yield equal-by-`.toEqual`
  // sentinel objects.
  arrayUnion: jest.fn((...values) => ({ __op: 'arrayUnion', values })),
  arrayRemove: jest.fn((...values) => ({ __op: 'arrayRemove', values })),
  getFirestore: jest.fn(() => 'mockFirestore'),
  getDocs: jest.fn(),
  addDoc: jest.fn(),
  writeBatch: jest.fn(),
  query: jest.fn(),
  where: jest.fn(),
  orderBy: jest.fn(),
  limit: jest.fn(),
  collection: jest.fn(),
}));
