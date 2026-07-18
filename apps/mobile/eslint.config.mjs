import { defineConfig, globalIgnores } from "eslint/config";
import tseslint from "typescript-eslint";

export default defineConfig([
  globalIgnores([".expo/**", "dist/**", "web-build/**", "node_modules/**"]),
  ...tseslint.configs.recommended,
  {
    // metro.config.js must be CommonJS — Metro loads it directly with
    // Node's `require`, before any bundler/transpiler is available.
    files: ["metro.config.js"],
    rules: {
      "@typescript-eslint/no-require-imports": "off",
    },
  },
]);
