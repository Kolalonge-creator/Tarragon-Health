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
  },
  testMatch: ["**/src/**/*.test.ts"],
};

export default config;
