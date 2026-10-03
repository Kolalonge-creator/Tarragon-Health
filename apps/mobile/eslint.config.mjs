import { defineConfig, globalIgnores } from "eslint/config";
import tseslint from "typescript-eslint";

export default defineConfig([
  globalIgnores([".expo/**", "dist/**", "web-build/**", "node_modules/**"]),
  ...tseslint.configs.recommended,
  {
    // Design system rules (design Phase 0). The kit and the design layer take every
    // colour and size from tokens: a raw hex or a literal fontSize there is an error.
    // Screens that have not moved onto the kit yet are warned, not failed, so the
    // count is visible and goes down as each screen moves (Phase 1 and 2).
    files: ["src/ui/kit/**/*.{ts,tsx}", "src/ui/design/**/*.{ts,tsx}"],
    ignores: ["src/ui/design/tokens.ts", "src/ui/design/typography.ts", "src/ui/design/**/*.test.ts"],
    rules: {
      "no-restricted-syntax": [
        "error",
        { selector: "Literal[value=/^#[0-9a-fA-F]{3,8}$/]", message: "Use a palette role from ui/design/tokens, not a raw hex colour." },
        { selector: "Property[key.name='fontSize'][value.type='Literal']", message: "Use a text variant from ui/design/typography, not a literal fontSize." },
      ],
    },
  },
  {
    files: ["src/screens/**/*.tsx", "src/ui/*.tsx", "App.tsx"],
    rules: {
      "no-restricted-syntax": [
        "warn",
        { selector: "Literal[value=/^#[0-9a-fA-F]{6}$/]", message: "Move this colour into ui/theme.ts or the design tokens (screens move onto the kit in design Phase 1 and 2)." },
        { selector: "Property[key.name='fontSize'][value.type='Literal']", message: "Use a text variant from the kit (AppText) when this screen moves onto it." },
      ],
    },
  },
  {
    // Screens already moved onto the design kit (design Phase 1). For these the
    // warnings above become errors, and the legacy colour and component modules are
    // off limits, so a moved screen cannot slip back. Add each screen here as it moves.
    files: ["src/screens/sections/vitals-screen.tsx", "src/screens/sections/medications-screen.tsx", "src/screens/sections/messages-screen.tsx", "src/screens/sync-banner.tsx"],
    rules: {
      "no-restricted-syntax": [
        "error",
        { selector: "Literal[value=/^#[0-9a-fA-F]{3,8}$/]", message: "Use a palette role from ui/design, not a raw hex colour." },
        { selector: "Property[key.name='fontSize'][value.type='Literal']", message: "Use AppText with a text variant, not a literal fontSize." },
      ],
      "no-restricted-imports": [
        "error",
        { paths: [
          { name: "@/ui/theme", message: "Moved screens use the design tokens (@/ui/design), not the legacy colours." },
          { name: "@/ui/components", message: "Moved screens use the kit (@/ui/kit), not the legacy components." },
        ] },
      ],
    },
  },
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
