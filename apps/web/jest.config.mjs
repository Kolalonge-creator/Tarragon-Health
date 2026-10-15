/**
 * Jest (ts-jest, CJS transform) for @tarragon/web.
 * Default environment is "node" — pure lib/validation logic is unit-tested
 * here, and Server Components/Actions and Route Handlers are exercised via
 * the running app. A `.test.tsx` file that needs a DOM (client-component
 * interaction tests, e.g. risk-assessment-form.test.tsx) opts into it per
 * file with a `/** @jest-environment jsdom *\/` docblock rather than
 * flipping the default for every test.
 */
/** @type {import('jest').Config} */
const config = {
  testEnvironment: "node",
  // CI stability (2026-10-14): the default is one worker per core with no memory ceiling, and the hosted runner was killed mid-suite
  // (about 5,300 tests). Cap the pool on CI and recycle any worker that grows past 1 GB. Locally the pool stays at half the cores.
  maxWorkers: process.env.CI ? 2 : "50%",
  workerIdleMemoryLimit: "1GB",
  transform: {
    "^.+\\.tsx?$": [
      "ts-jest",
      { tsconfig: { module: "commonjs", moduleResolution: "node", jsx: "react-jsx" }, diagnostics: { ignoreCodes: [5097] } },
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
    // S03: the breached-password check is a network call; under Jest it is replaced by a hermetic stub.
    "^@tarragon/auth/password-check$": "<rootDir>/src/test/password-check-stub.ts",
  },
  testMatch: ["**/src/**/*.test.ts", "**/src/**/*.test.tsx"],
};

export default config;
