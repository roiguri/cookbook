import { jest } from '@jest/globals';

/**
 * Mock for 'firebase/functions'.
 *
 * Purpose: Prevents real Cloud Functions calls during tests by mocking:
 *   - getFunctions: returns a dummy functions object
 *   - connectFunctionsEmulator: no-op (emulator mode)
 *   - httpsCallable: returns a mock callable
 *
 * Use this mock when your code or tests import from 'firebase/functions'.
 */
jest.unstable_mockModule('firebase/functions', () => ({
  getFunctions: jest.fn(() => 'mockFunctions'),
  connectFunctionsEmulator: jest.fn(),
  httpsCallable: jest.fn(() => jest.fn()),
}));
