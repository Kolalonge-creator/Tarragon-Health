/**
 * Jest (ESM + ts-jest) for @tarragon/audio. Emergency guidance and number stitching are safety-relevant
 * (INV-06, safety case 1): the threshold fails the run if a branch of the pure logic is not exercised.
 */
/** @type {import('jest').Config} */
export default {
  testEnvironment: "node",
  extensionsToTreatAsEsm: [".ts"],
  moduleNameMapper: {
    "^(\\.{1,2}/.*)\\.js$": "$1",
  },
  transform: {
    "^.+\\.ts$": ["ts-jest", { useESM: true, tsconfig: { module: "esnext", target: "ES2022", moduleResolution: "bundler", esModuleInterop: true, skipLibCheck: true, verbatimModuleSyntax: false, resolveJsonModule: true, allowImportingTsExtensions: true } }],
  },
  testMatch: ["**/src/**/*.test.ts"],
  collectCoverageFrom: ["src/**/*.ts", "!src/**/*.test.ts", "!src/index.ts", "!src/types.ts"],
  coverageThreshold: { global: { branches: 95, functions: 100, lines: 98, statements: 98 } },
};
