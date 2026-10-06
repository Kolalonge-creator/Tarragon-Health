/**
 * Jest (ESM + ts-jest) for @tarragon/queue. The state machine and the triage handler live in
 * supabase/functions/_shared/queue (an edge function cannot import a workspace package) and are imported from there.
 * They decide who is offered clinical work and when, so every branch is covered (S16, spec Section 15).
 */
/** @type {import('jest').Config} */
export default {
  rootDir: "../..",
  roots: ["<rootDir>/packages/queue/src"],
  testEnvironment: "node",
  extensionsToTreatAsEsm: [".ts"],
  moduleNameMapper: { "^(\\.{1,2}/.*)\\.js$": "$1" },
  transform: {
    "^.+\\.ts$": ["ts-jest", { useESM: true, tsconfig: { module: "esnext", target: "ES2022", moduleResolution: "bundler", esModuleInterop: true, skipLibCheck: true, verbatimModuleSyntax: false, allowImportingTsExtensions: true } }],
  },
  testMatch: ["**/src/**/*.test.ts"],
  collectCoverageFrom: [
    "<rootDir>/supabase/functions/_shared/queue/*.ts",
    "<rootDir>/supabase/functions/process-events/queue-ports.ts",
  ],
  coverageProvider: "v8",
  coverageThreshold: { global: { branches: 100, functions: 100, lines: 100, statements: 100 } },
};
