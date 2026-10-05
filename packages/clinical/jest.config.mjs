/**
 * Jest (ESM + ts-jest) for @tarragon/clinical. The triage engine decides when a
 * patient is told to seek emergency care, so every branch of it must be covered
 * (S11, spec Section 15): the threshold below fails the run if one is not.
 */
/** @type {import('jest').Config} */
export default {
  testEnvironment: "node",
  extensionsToTreatAsEsm: [".ts"],
  moduleNameMapper: {
    "^(\\.{1,2}/.*)\\.js$": "$1",
  },
  transform: {
    "^.+\\.ts$": ["ts-jest", { useESM: true, tsconfig: { verbatimModuleSyntax: false, resolveJsonModule: true } }],
  },
  testMatch: ["**/src/**/*.test.ts"],
  collectCoverageFrom: ["src/**/*.ts", "!src/**/*.test.ts", "!src/index.ts", "!src/types.ts", "!src/**/*.fixtures.ts"],
  coverageThreshold: { global: { branches: 100, functions: 100, lines: 100, statements: 100 } },
};
