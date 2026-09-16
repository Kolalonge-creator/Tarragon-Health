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
  testMatch: ["**/src/**/*.test.ts", "**/src/**/*.test.tsx"],
};

export default config;
