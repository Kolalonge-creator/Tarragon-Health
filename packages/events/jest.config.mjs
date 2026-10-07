/**
 * Jest (ESM + ts-jest) for @tarragon/events. The processor loop lives in
 * supabase/functions/_shared/event-bus/dispatch.ts (an edge function cannot import a workspace package) and is
 * imported from there. It decides what is retried and what is dead-lettered, so every branch is covered.
 */
/** @type {import('jest').Config} */
export default {
  rootDir: "../..",
  roots: ["<rootDir>/packages/events/src"],
  testEnvironment: "node",
  extensionsToTreatAsEsm: [".ts"],
  moduleNameMapper: { "^(\\.{1,2}/.*)\\.js$": "$1" },
  transform: {
    "^.+\\.ts$": ["ts-jest", { useESM: true, tsconfig: { module: "esnext", target: "ES2022", moduleResolution: "bundler", esModuleInterop: true, skipLibCheck: true } }],
  },
  testMatch: ["**/src/**/*.test.ts"],
  collectCoverageFrom: [
    "<rootDir>/supabase/functions/_shared/event-bus/dispatch.ts",
    "<rootDir>/supabase/functions/_shared/rewards/points-handler.ts",
    "<rootDir>/supabase/functions/process-events/points-ports.ts",
  ],
  coverageProvider: "v8",
  coverageThreshold: { global: { branches: 100, functions: 100, lines: 100, statements: 100 } },
};
