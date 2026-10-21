import { describe, expect, it } from "@jest/globals";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { getProposedConfig } from "@tarragon/shared";

/**
 * The pure eligibility function (lowcarb-programme.ts) and its enforcing database twin (private.lowcarb_eligibility_for) must agree. Both are tested
 * against the same numbered cases (L01..); this pins the two case lists together, and pins the config and the draft step table to the migration seed.
 */
const HERE = fileURLToPath(new URL(".", import.meta.url));
const ids = (text: string): string[] => [...new Set([...text.matchAll(/\b([LM]\d{2})\b/g)].map((m) => m[1] as string))].sort();
const MIGRATIONS = join(HERE, "..", "..", "..", "supabase", "migrations");

function migration(): string {
  const file = readdirSync(MIGRATIONS).find((f) => f.endsWith("_s50b_lowcarb_t2d_programme.sql"));
  if (!file) throw new Error("S50b migration not found");
  return readFileSync(join(MIGRATIONS, file), "utf8");
}

describe("low-carbohydrate parity with the SQL proof", () => {
  const ts = readFileSync(join(HERE, "lowcarb-programme.test.ts"), "utf8");
  const sql = readFileSync(join(HERE, "..", "..", "db", "tests", "s50b_lowcarb_t2d_programme.sql"), "utf8");

  it("the same case ids appear in both", () => {
    const tsIds = ids(ts);
    expect(tsIds.length).toBeGreaterThanOrEqual(44);
    expect(ids(sql)).toEqual(tsIds);
  });

  it("the proof is registered in the CI manifest", () => {
    const manifest = readFileSync(join(HERE, "..", "..", "db", "tests", "ci.manifest"), "utf8");
    expect(manifest.split("\n")).toContain("s50b_lowcarb_t2d_programme.sql");
  });

  it("the migration seed equals the registry entry, and both are PROPOSED for the CMO", () => {
    const m = /lowcarb-protocol-config-begin[\s\S]*?\$json\$([\s\S]*?)\$json\$/.exec(migration());
    if (!m?.[1]) throw new Error("config seed not found");
    expect(JSON.parse(m[1])).toEqual(getProposedConfig("lowcarb.protocol_rules").value);
    const e = getProposedConfig("lowcarb.protocol_rules");
    expect(e.status).toBe("proposed");
    expect(e.owner).toBe("CMO");
  });

  it("the draft step table fixture equals the migration seed and is a placeholder draft", () => {
    const m = /lowcarb-step-table-begin[\s\S]*?\$json\$([\s\S]*?)\$json\$/.exec(migration());
    if (!m?.[1]) throw new Error("step table seed not found");
    const fixture = JSON.parse(readFileSync(join(HERE, "..", "fixtures", "lowcarb-step-table.json"), "utf8"));
    expect(JSON.parse(m[1])).toEqual(fixture);
    expect(fixture.status).toBe("draft");
    expect(fixture.placeholder).toBe(true);
  });

  it("the migration never switches anything on or signs anything", () => {
    const text = migration();
    expect(text).not.toMatch(/set_go_live_guard\s*\(/);
    expect(text).not.toMatch(/insert into public\.go_live_attestations/);
    expect(text).not.toMatch(/is_on\s*=\s*true/);
    expect(text).not.toMatch(/approve_protocol\s*\(/);
  });
});
