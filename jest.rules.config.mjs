/**
 * Jest config for Firestore + Storage security-rules tests.
 * Run with `npm run test:rules`, which starts the emulators (demo project, no real data).
 */
/** @type {import('jest').Config} */
const config = {
  testEnvironment: 'node',
  testMatch: ['<rootDir>/tests/rules/**/*.test.js'],
  // The rules tests share one emulator instance; run files one at a time.
  maxWorkers: 1,
  testTimeout: 20000,
};

export default config;
