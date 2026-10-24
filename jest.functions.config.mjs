/**
 * Jest config for Cloud Functions integration tests: the real functions in the
 * Functions emulator, with Auth + Firestore emulators (demo project, no real data).
 * Run with `npm run test:functions` (needs Java 21+, like the rules tests).
 */
/** @type {import('jest').Config} */
const config = {
  testEnvironment: 'node',
  testMatch: ['<rootDir>/tests/functions/**/*.test.js'],
  // One emulator instance for all files.
  maxWorkers: 1,
  testTimeout: 30000,
};

export default config;
