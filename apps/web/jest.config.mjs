/**
 * Jest (ts-jest, CJS transform) for @tarragon/web.
 * Only pure lib/validation logic is unit-tested here — Server
 * Components/Actions and Route Handlers are exercised via the running app.
 */
/** @type {import('jest').Config} */
const config = {
  testEnvironment: "node",
  transform: {
    "^.+\\.tsx?$": [
      "ts-jest",
      { tsconfig: { module: "commonjs", moduleResolution: "node", jsx: "react-jsx" } },
    ],
  },
  moduleNameMapper: {
    "^@/(.*)$": "<rootDir>/src/$1",
    // `server-only` is a build-time marker with no runtime module, so importing
    // a server module under Jest fails to resolve it. Stubbed so that a module
    // which is correctly marked server-only can still have its pure logic
    // unit-tested (lib/lab-reports/heic.ts, whose HEIC decoding is worth a real
    // test against a real HEIC file).
    "^server-only$": "<rootDir>/src/test/server-only-stub.ts",
  },
  testMatch: ["**/src/**/*.test.ts"],
};

export default config;
