/**
 * Jest (ESM + ts-jest) for @tarragon/notifications. The processor loop lives in
 * supabase/functions/_shared/event-bus/dispatch.ts (an edge function cannot import a workspace package) and is
 * imported from there. It decides what is retried and what is dead-lettered, so every branch is covered.
 */
/** @type {import('jest').Config} */
export default {
  rootDir: "../..",
  roots: ["<rootDir>/packages/notifications/src"],
  testEnvironment: "node",
  extensionsToTreatAsEsm: [".ts"],
  transform: {
    "^.+\\.ts$": ["ts-jest", { useESM: true, tsconfig: { module: "esnext", target: "ES2022", moduleResolution: "bundler", esModuleInterop: true, skipLibCheck: true } }],
  },
  testMatch: ["**/src/**/*.test.ts"],
  moduleNameMapper: { "^(\\.{1,2}/.*)\\.js$": "$1", "^@tarragon/i18n$": "<rootDir>/packages/i18n/src/index.ts", "^@/(.*)$": "<rootDir>/apps/web/src/$1" },
  collectCoverageFrom: ["<rootDir>/supabase/functions/_shared/notifications/*.ts"],
  coverageProvider: "v8",
  coverageThreshold: { global: { branches: 100, functions: 100, lines: 100, statements: 100 } },
};
