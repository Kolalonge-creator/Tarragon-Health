/**
 * Jest config for E2E tests that exercise real Supabase infra (DB triggers +
 * deployed Edge Functions). Separate from jest.config.mjs on purpose: these
 * hit network/the live project, so they must never run as part of the
 * default `pnpm test` — only via the explicit `test:e2e` script, with
 * NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY set in the shell.
 */
/** @type {import('jest').Config} */
const config = {
  testEnvironment: "node",
  transform: {
    "^.+\\.tsx?$": [
      "ts-jest",
      { tsconfig: { module: "commonjs", moduleResolution: "node", jsx: "react-jsx" } },
    ],
  },
  moduleNameMapper: {
    "^@/(.*)$": "<rootDir>/src/$1",
  },
  testMatch: ["**/e2e/**/*.e2e.test.ts"],
  testTimeout: 30_000,
};

export default config;
