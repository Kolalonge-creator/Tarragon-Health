import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { en } from "./en";

/**
 * W-46: the display names of the two paid tiers. membership_annual includes the yearly blood panel, so it is Membership Plus.
 * "Tarragon Membership" was the old name for that product and must not come back anywhere customer-facing.
 */
const REPO = join(process.cwd(), "..", "..");

function walk(dir: string, ext: RegExp): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (name === "node_modules") continue;
    if (statSync(p).isDirectory()) out.push(...walk(p, ext));
    else if (ext.test(name)) out.push(p);
  }
  return out;
}

/** Files that may mention the old name, and why. Anything else fails. */
const OLD_NAME_ALLOWED: Record<string, string> = {
  "packages/i18n/src/tier-names.test.ts": "this test names the phrase it bans",
};

describe("membership tier display names", () => {
  it("names the panel-included product Membership Plus and the no-panel product Membership", () => {
    expect(en["catalog.membership_annual.name"]).toBe("Membership Plus");
    expect(en["catalog.membership_annual_no_panel.name"]).toBe("Membership");
  });

  it("no string in any en.ts namespace uses the old name 'Tarragon Membership'", () => {
    const offenders = Object.entries(en).filter(([, v]) => /Tarragon Membership/.test(String(v))).map(([k]) => k);
    expect(offenders).toEqual([]);
  });

  it("no legal doc or edge function uses 'Tarragon Membership'", () => {
    const files = [
      ...walk(join(REPO, "docs", "legal"), /\.(md|sql|txt)$/),
      ...walk(join(REPO, "supabase", "functions"), /\.(ts|json)$/),
      ...walk(join(REPO, "apps", "web", "src"), /\.(ts|tsx)$/),
      ...walk(join(REPO, "apps", "mobile", "src"), /\.(ts|tsx)$/),
    ];
    const hits = files
      .filter((f) => /Tarragon Membership/.test(readFileSync(f, "utf8")))
      .map((f) => f.slice(REPO.length + 1))
      .filter((rel) => !(rel in OLD_NAME_ALLOWED));
    expect(hits).toEqual([]);
  });

  it("sabotage: the old-name pattern does catch the old name", () => {
    expect(/Tarragon Membership/.test("Your employer offered a Tarragon Membership")).toBe(true);
    expect(/Tarragon Membership/.test("Your employer offered a Membership Plus year")).toBe(false);
  });
});
