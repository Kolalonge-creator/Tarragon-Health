import { describe, expect, it } from "@jest/globals";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { GOVERNED_CONFIG_TABLES } from "@/lib/queries/governed-config-signoff";

/**
 * The hub opens each governed configuration's own manager inline, through a
 * hand-kept map keyed by table name. A table added to the queue without an entry
 * here would silently fall back to a plain link, so this pins the two lists
 * together. (A source scan, because the page module pulls in server-only data
 * loaders that a unit test cannot import.)
 */
describe("sign-off hub inline panels", () => {
  const source = readFileSync(join(__dirname, "page.tsx"), "utf8");
  const block = source.slice(source.indexOf("const CONFIG_PANELS"), source.indexOf("};", source.indexOf("const CONFIG_PANELS")));
  const keys = [...block.matchAll(/^\s{2}([a-z_]+): \(\) =>/gm)].map((m) => m[1]);

  it("has an inline panel for every governed configuration the queue can list", () => {
    expect([...keys].sort()).toEqual(GOVERNED_CONFIG_TABLES.map((t) => t.table).sort());
  });

  it("renders each table's panel from the shared panels folder, not a copy", () => {
    for (const t of GOVERNED_CONFIG_TABLES) {
      const slug = t.slug;
      expect(source).toContain(`../_signoff-panels/${slug}-panel`);
    }
  });
});
