import { defineConfig, globalIgnores } from "eslint/config";
import tseslint from "typescript-eslint";

// Shared-package lint (v5 S01 foundations). Same flat-config shape as apps/mobile.
export default defineConfig([
  globalIgnores(["dist/**", "node_modules/**", "**/database.types.ts"]),
  ...tseslint.configs.recommended,
  {
    rules: {
      // An underscore prefix is the repo's marker for a deliberately unused parameter.
      "@typescript-eslint/no-unused-vars": ["error", { argsIgnorePattern: "^_", varsIgnorePattern: "^_" }],
    },
  },
]);
