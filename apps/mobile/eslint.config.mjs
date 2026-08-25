import { defineConfig, globalIgnores } from "eslint/config";
import tseslint from "typescript-eslint";

export default defineConfig([
  globalIgnores([".expo/**", "dist/**", "web-build/**", "node_modules/**"]),
  ...tseslint.configs.recommended,
  {
    // metro.config.js must be CommonJS — Metro loads it directly with
    // Node's `require`, before any bundler/transpiler is available. Expo
    // config plugins (plugins/**) are loaded the same way, by `expo
    // prebuild`'s own Node process, ahead of any bundler too.
    files: ["metro.config.js", "plugins/**/*.js"],
    rules: {
      "@typescript-eslint/no-require-imports": "off",
    },
  },
]);
