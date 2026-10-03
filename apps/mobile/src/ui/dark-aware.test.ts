import { readFileSync } from "fs";
import { join } from "path";

/**
 * Screens that have been made scheme-aware by swapping to the legacy-kit primitives and
 * the useLegacyColors bridge (instead of rewriting on the full kit). Each must stay fully
 * switched: one stray import of the static light `colors` or of the light-only components
 * puts dark text on a dark card in Dark mode. Add a screen here when it moves.
 */
const FILES = ["screens/sections/profile-screen.tsx"];

describe("scheme-aware legacy screens stay fully switched", () => {
  it.each(FILES)("%s", (file) => {
    const source = readFileSync(join(__dirname, "..", file), "utf8");
    expect(source).not.toMatch(/import\s*\{[^}]*\bcolors\b[^}]*\}\s*from\s*"@\/ui\/theme"/);
    expect(source).not.toMatch(/from\s*"@\/ui\/components"/);
    expect(source).toMatch(/useLegacyColors/);
  });
});
