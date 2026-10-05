/**
 * Jest (ESM + ts-jest) for @tarragon/events. The processor loop's source of truth is
 * supabase/functions/_shared/event-bus/dispatch.ts (an edge function cannot import a workspace package);
 * src/dispatch.ts is a byte-for-byte copy made by `pnpm sync`, and a test fails if they differ.
 * It decides what is retried and what is dead-lettered, so every branch is covered.
 */
/** @type {import('jest').Config} */
export default {
  testEnvironment: "node",
  extensionsToTreatAsEsm: [".ts"],
  moduleNameMapper: { "^(\\.{1,2}/.*)\\.js$": "$1" },
  transform: {
    "^.+\\.ts$": ["ts-jest", { useESM: true, tsconfig: { verbatimModuleSyntax: false } }],
  },
  testMatch: ["**/src/**/*.test.ts"],
  collectCoverageFrom: ["src/dispatch.ts"],
  coverageThreshold: { global: { branches: 100, functions: 100, lines: 100, statements: 100 } },
};
