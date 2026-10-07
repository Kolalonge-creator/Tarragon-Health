import { describe, expect, it } from "@jest/globals";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { getProposedConfig } from "./index";

const MIGRATIONS = join(fileURLToPath(new URL(".", import.meta.url)), "..", "..", "..", "..", "supabase", "migrations");

/** Every `-- s68-config-<key>-begin ... $json$ {...} $json$ ... -- s68-config-<key>-end` block in the S68 migrations; a later migration wins. */
function seeded(): Map<string, unknown> {
  const out = new Map<string, unknown>();
  const files = readdirSync(MIGRATIONS).filter((f) => /_s68[a-z]_.*\.sql$/.test(f)).sort();
  for (const f of files) {
    const sql = readFileSync(join(MIGRATIONS, f), "utf8");
    for (const m of sql.matchAll(/-- s68-config-([a-z0-9_.]+)-begin[\s\S]*?\$json\$([\s\S]*?)\$json\$[\s\S]*?-- s68-config-\1-end/g)) {
      out.set(m[1] as string, JSON.parse(m[2] as string));
    }
  }
  return out;
}

const KEYS = [
  "growth.reference_versions",
  "growth.plausibility",
  "growth.nutrition_routing",
  "epds.cutoffs",
  "postnatal.checks",
  "lifecycle.rules",
  "retention.rules",
];

describe("S68 maternal_child_config mirrors the migration seeds", () => {
  const db = seeded();

  it("seeds exactly the seven keys the registry carries", () => {
    expect([...db.keys()].sort()).toEqual([...KEYS].sort());
  });

  it.each(KEYS)("%s is identical in the registry and the database seed", (key) => {
    expect(db.get(key)).toEqual(getProposedConfig(`maternal_child.${key}`).value);
  });

  it.each(KEYS)("%s is still proposed: nothing here may be confirmed by an agent", (key) => {
    const e = getProposedConfig(`maternal_child.${key}`);
    expect(e.status).toBe("proposed");
  });

  it("nutrition routing carries the A7 numbers and no more (115 and 125 mm, z -3 and -2, 3 days)", () => {
    const v = getProposedConfig<Record<string, number | boolean>>("maternal_child.growth.nutrition_routing").value;
    expect(v.sam_muac_mm_lt).toBe(115);
    expect(v.mam_muac_mm_lt).toBe(125);
    expect(v.sam_wfh_z_lt).toBe(-3);
    expect(v.mam_wfh_z_lt).toBe(-2);
    expect(v.mam_review_within_days).toBe(3);
    expect(v.sam_oedema).toBe(true);
  });

  it("EPDS carries the A6 numbers: 10, 13, 7 days, 48 hours, item 10 any non-zero", () => {
    const v = getProposedConfig<Record<string, number | boolean>>("maternal_child.epds.cutoffs").value;
    expect(v.possible_min).toBe(10);
    expect(v.probable_min).toBe(13);
    expect(v.possible_review_within_days).toBe(7);
    expect(v.probable_review_within_hours).toBe(48);
    expect(v.item_10_any_nonzero_is_crisis).toBe(true);
  });

  it("no em dash in the S68 registry block", () => {
    const reg = readFileSync(join(fileURLToPath(new URL(".", import.meta.url)), "registry.ts"), "utf8");
    const block = reg.slice(reg.indexOf("// S68 (Module 16, postnatal and child)"));
    expect(block.includes("\u2014")).toBe(false);
  });
});
