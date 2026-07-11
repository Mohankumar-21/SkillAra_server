/** @type {import('jest').Config} */
export default {
  testEnvironment: "node",
  transform: {},
  setupFilesAfterEnv: ["./tests/setup.js"],
  testMatch: ["**/tests/**/*.test.js"],
  testTimeout: 60000,
};
