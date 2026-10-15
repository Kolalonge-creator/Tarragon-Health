/**
 * Jest (ESM + ts-jest) for @tarragon/medicines. The schedule, dose-state,
 * adherence and supply logic is pure and safety-relevant, so every branch of
 * it must be covered (S08): the threshold below fails the run if one is not.
 */
/** @type {import('jest').Config} */
export default {
  testEnvironment: "node",
  extensionsToTreatAsEsm: [".ts"],
  moduleNameMapper: {
    "^(\\.{1,2}/.*)\\.js$": "$1",
  },
  transform: {
    "^.+\\.ts$": ["ts-jest", { useESM: true, tsconfig: { verbatimModuleSyntax: false } }],
  },
  testMatch: ["**/src/**/*.test.ts"],
  collectCoverageFrom: ["src/**/*.ts", "!src/**/*.test.ts", "!src/index.ts", "!src/types.ts", "!src/**/*.fixtures.ts", "!src/safety/**"],
  coverageThreshold: { global: { branches: 100, functions: 100, lines: 100, statements: 100 } },
};
