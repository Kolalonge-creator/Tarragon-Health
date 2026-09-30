/**
 * Jest (ESM + ts-jest) for @tarragon/auth.
 * The package is `type: module`; ts-jest transforms .ts on the fly.
 */
/** @type {import('jest').Config} */
export default {
  testEnvironment: "node",
  extensionsToTreatAsEsm: [".ts", ".tsx"],
  moduleNameMapper: {
    // Allow ESM-style ".js" import specifiers to resolve to ".ts" sources.
    "^(\\.{1,2}/.*)\\.js$": "$1",
  },
  transform: {
    "^.+\\.tsx?$": [
      "ts-jest",
      {
        useESM: true,
        // verbatimModuleSyntax off for the transform so ts-jest can emit
        // interop-friendly ESM without requiring `import type` everywhere.
        tsconfig: { verbatimModuleSyntax: false, jsx: "react-jsx" },
      },
    ],
  },
  testMatch: ["**/src/**/*.test.ts", "**/src/**/*.test.tsx"],
};
