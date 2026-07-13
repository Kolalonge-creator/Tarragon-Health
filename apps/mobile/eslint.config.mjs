import { defineConfig, globalIgnores } from "eslint/config";
import tseslint from "typescript-eslint";

export default defineConfig([
  globalIgnores([".expo/**", "dist/**", "web-build/**", "node_modules/**"]),
  ...tseslint.configs.recommended,
]);
