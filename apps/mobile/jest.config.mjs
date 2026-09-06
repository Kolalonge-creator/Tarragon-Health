/**
 * Jest for @tarragon/mobile.
 *
 * `jest-expo` (pinned by Expo SDK 54's own bundledNativeModules.json to
 * ~54.0.17) rather than the plain ts-jest/node config apps/web uses: this
 * package's modules import `react-native` (ble.ts) and rely on `__DEV__`
 * (sync-diagnostics.ts), both of which the Expo preset provides via
 * babel-preset-expo and its own setup file. Note the SDK-54 preset is built
 * against the Jest 29 line, so this package deliberately runs Jest 29 while
 * apps/web and packages/shared stay on 30 — turbo runs each package's own
 * `test` script, so the two never share a runner.
 *
 * Scope is pure logic only: classifiers, the offline queues, the BLE
 * service/parser wiring, and the API request policy. No screen/component
 * rendering — those are exercised on a real device (see CLAUDE.md's Device &
 * Wearable Integration section).
 */
/** @type {import('jest').Config} */
export default {
  preset: "jest-expo",
  setupFiles: ["<rootDir>/jest.env.ts"],
  setupFilesAfterEnv: ["<rootDir>/jest.setup.ts"],
  testMatch: ["<rootDir>/src/**/*.test.ts"],
  moduleNameMapper: {
    "^@/(.*)$": "<rootDir>/src/$1",
  },
  clearMocks: true,
};
