import { describe, expect, it } from "@jest/globals";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { causalWordingHits } from "../causal-wording";
import { getProposedConfig, PROPOSED_CONFIG } from "./index";

const MIGRATIONS = join(fileURLToPath(new URL(".", import.meta.url)), "..", "..", "..", "..", "supabase", "migrations");

type Wording = Record<string, string | number>;

describe("sponsor.methods_disclosure_wording mirrors the migration (GAP-71)", () => {
  const file = readdirSync(MIGRATIONS).find((f) => f.endsWith("_gap71_sponsor_methods_and_funding_disclosure.sql"));
  if (!file) throw new Error("GAP-71 migration not found");
  const sql = readFileSync(join(MIGRATIONS, file), "utf8");
  const cfg = getProposedConfig<Wording>("sponsor.methods_disclosure_wording");

  it("is identical to the constant in the migration", () => {
    const match = /methods-wording-v1-begin[\s\S]*?\$json\$([\s\S]*?)\$json\$/.exec(sql);
    if (!match?.[1]) throw new Error("wording not found in the migration");
    expect(JSON.parse(match[1])).toEqual(cfg.value);
  });

  it("is PROPOSED and owned by the CMO, never signed in code", () => {
    const e = PROPOSED_CONFIG.find((x) => x.key === "sponsor.methods_disclosure_wording");
    expect(e?.status).toBe("proposed");
    expect(e?.owner).toBe("CMO");
  });

  it("the guard is seeded off and no review is seeded", () => {
    expect(sql).toMatch(/insert into public\.go_live_guards[\s\S]*'sponsor_methods_disclosure_enabled'/);
    // the only insert is inside the admin/CMO function (parameters, never literals), and the migration asserts the table is empty when it ends
    const inserts = sql.match(/insert into public\.sponsor_independent_reviews[^;]*;/g) ?? [];
    expect(inserts).toHaveLength(1);
    expect(inserts[0]).toMatch(/values \(p_cohort, btrim\(p_reviewer_name\)/);
    expect(sql).toContain("a review must never be seeded");
    expect(sql).not.toMatch(/is_on\s*=\s*true|update public\.go_live_guards/);
  });

  it("states the review as absent by default and carries every placeholder the database fills", () => {
    expect(cfg.value.review_none).toBe("These figures have not been independently reviewed.");
    for (const p of ["{sponsor}", "{minimum}"]) expect(JSON.stringify(cfg.value)).toContain(p);
    for (const p of ["{reviewer}", "{organisation}", "{date}", "{scope}"]) expect(String(cfg.value.review_done)).toContain(p);
  });

  it("makes no causal claim (the pack word list)", () => {
    const text = Object.values(cfg.value).filter((v): v is string => typeof v === "string");
    expect(causalWordingHits(text.join(". "))).toEqual([]);
  });
});
