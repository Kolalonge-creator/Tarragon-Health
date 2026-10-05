/**
 * Jest (ESM + ts-jest) for @tarragon/clinical. The triage engine decides when a
 * patient is told to seek emergency care, so every branch of it must be covered
 * (S11, spec Section 15): the threshold below fails the run if one is not.
 */
/** @type {import('jest').Config} */
export default {
  rootDir: "../..",
  roots: ["<rootDir>/packages/clinical/src"],
  testEnvironment: "node",
  extensionsToTreatAsEsm: [".ts"],
  moduleNameMapper: {
    "^(\\.{1,2}/.*)\\.js$": "$1",
  },
  transform: {
    "^.+\\.ts$": ["ts-jest", { useESM: true, tsconfig: { module: "esnext", target: "ES2022", moduleResolution: "bundler", esModuleInterop: true, skipLibCheck: true, verbatimModuleSyntax: false, resolveJsonModule: true, allowImportingTsExtensions: true } }],
  },
  testMatch: ["**/src/**/*.test.ts"],
  collectCoverageFrom: [
    "<rootDir>/supabase/functions/_shared/clinical/*.ts",
    "!<rootDir>/supabase/functions/_shared/clinical/types.ts",
    "<rootDir>/supabase/functions/_shared/triage/*.ts",
    "<rootDir>/supabase/functions/process-events/triage-ports.ts",
    "<rootDir>/packages/clinical/src/rules/*.ts",
  ],
  coverageThreshold: { global: { branches: 100, functions: 100, lines: 100, statements: 100 } },
};
