/**
 * Jest (ESM + ts-jest) for @tarragon/integrations. The adapter source lives in
 * supabase/functions/_shared/integrations (an edge function cannot import a workspace package) and is imported
 * from there. Contract suites in src/contracts run against every implementation of an interface.
 */
/** @type {import('jest').Config} */
export default {
  rootDir: "../..",
  roots: ["<rootDir>/packages/integrations/src"],
  testEnvironment: "node",
  extensionsToTreatAsEsm: [".ts"],
  transform: {
    "^.+\\.ts$": ["ts-jest", { useESM: true, tsconfig: { module: "esnext", target: "ES2022", moduleResolution: "bundler", esModuleInterop: true, skipLibCheck: true, allowImportingTsExtensions: true, noEmit: true } }],
  },
  testMatch: ["**/src/**/*.test.ts"],
  moduleNameMapper: { "^(\\.{1,2}/.*)\\.js$": "$1" },
  collectCoverageFrom: ["<rootDir>/supabase/functions/_shared/integrations/*.ts", "!<rootDir>/supabase/functions/_shared/integrations/index.ts"],
  coverageProvider: "v8",
  coverageThreshold: { global: { branches: 95, functions: 100, lines: 100, statements: 100 } },
};
