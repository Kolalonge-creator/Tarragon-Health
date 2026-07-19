/**
 * Jest (ESM + ts-jest) for @tarragon/lifestyle-engine.
 * Mirrors @tarragon/shared: the package is `type: module`; ts-jest transforms .ts on the fly.
 */
/** @type {import('jest').Config} */
export default {
  testEnvironment: "node",
  extensionsToTreatAsEsm: [".ts"],
  moduleNameMapper: {
    // Allow ESM-style ".js" import specifiers to resolve to ".ts" sources.
    "^(\\.{1,2}/.*)\\.js$": "$1",
  },
  transform: {
    "^.+\\.ts$": [
      "ts-jest",
      {
        useESM: true,
        tsconfig: { verbatimModuleSyntax: false },
      },
    ],
  },
  testMatch: ["**/src/**/*.test.ts"],
};
