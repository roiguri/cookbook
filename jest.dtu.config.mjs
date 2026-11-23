/** @type {import('jest').Config} */
export default {
  testEnvironment: 'node',
  testMatch: ['<rootDir>/tests/dtu/**/*.test.mjs'],
  maxWorkers: 1,
  testTimeout: 30000,
  transform: {},
};
