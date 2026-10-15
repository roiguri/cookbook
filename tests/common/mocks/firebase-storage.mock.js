import { jest } from '@jest/globals';

/**
 * Mock for 'firebase/storage'.
 *
 * Purpose: Prevents real Firebase Storage/network calls during tests by mocking:
 *   - getStorage: returns a dummy storage object
 *   - ref: returns a mock reference object
 *   - uploadBytes: mock upload function
 *   - getDownloadURL: mock download URL function
 *   - deleteObject: mock delete function
 *   - listAll: mock listAll function
 *   - getMetadata: mock getMetadata function
 *
 * Use this mock when your code or tests import from 'firebase/storage'.
 */
jest.unstable_mockModule('firebase/storage', () => ({
  getStorage: jest.fn(() => 'mockStorage'),
  connectStorageEmulator: jest.fn(),
  ref: jest.fn((storage, path) => ({ storage, path })),
  uploadBytes: jest.fn(),
  getDownloadURL: jest.fn(),
  deleteObject: jest.fn(),
  listAll: jest.fn(),
  getMetadata: jest.fn(),
}));
