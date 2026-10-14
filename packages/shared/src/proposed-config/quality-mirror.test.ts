import { describe, expect, it } from "@jest/globals";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { getProposedConfig } from "./index";

const MIGRATIONS = join(fileURLToPath(new URL(".", import.meta.url)), "..", "..", "..", "..", "supabase", "migrations");

function seed(fileSuffix: string, marker: string): unknown {
  const file = readdirSync(MIGRATIONS).find((f) => f.endsWith(fileSuffix));
  if (!file) throw new Error(`${fileSuffix} migration not found`);
  const match = new RegExp(`${marker}-begin[\\s\\S]*?\\$json\\$([\\s\\S]*?)\\$json\\$`).exec(readFileSync(join(MIGRATIONS, file), "utf8"));
  if (!match?.[1]) throw new Error(`${marker} seed not found in the migration`);
  return JSON.parse(match[1]);
}

describe("quality.audit mirrors the migration seeds", () => {
  it("version 1 is identical to the quality_config v1 seed (never edited)", () => {
    expect(seed("_s20_quality_and_safety.sql", "quality-audit")).toEqual(getProposedConfig("quality.audit", "2026-10-06").value);
  });

  it("version 2 is identical to the quality_config v2 seed, proposed and owned by the CMO", () => {
    const v2 = getProposedConfig("quality.audit", "2026-10-14");
    expect(v2.version).toBe(2);
    expect(v2.status).toBe("proposed");
    expect(v2.owner).toBe("CMO");
    expect(seed("_audit_review_sampling_and_config_guard.sql", "quality-audit-v2")).toEqual(v2.value);
  });

  it("the spec's proposals hold (7.8): 10 percent, every red event and titration, in both versions", () => {
    for (const asOf of ["2026-10-06", "2026-10-14"]) {
      const v = getProposedConfig("quality.audit", asOf).value as { sampling: { random_rate_percent: number; always_reasons: string[] } };
      expect(v.sampling.random_rate_percent).toBe(10);
      expect(v.sampling.always_reasons).toEqual(["red_event", "titration"]);
    }
  });

  it("the CMO's recorded decisions are in version 2 (plan section 5, decisions 5 to 7)", () => {
    const v = getProposedConfig("quality.audit", "2026-10-14").value as {
      sampling: { scribe_assisted_rate_percent: number; stratified: boolean; seed: { rotation: string } };
      form: { phases: string[]; avoidability: { scale: string[] }; scribe_items: string[] };
      second_review: { required_on: string[] };
      speak_up: { checkin_days: number[]; about_lead_routes_to: string };
    };
    expect(v.sampling.scribe_assisted_rate_percent).toBe(20);
    expect(v.sampling.stratified).toBe(true);
    expect(v.sampling.seed.rotation).toBe("monthly");
    expect(v.form.phases).toEqual(["assessment", "decision", "action", "documentation"]);
    expect(v.form.avoidability.scale).toContain("definitely_avoidable");
    expect(v.form.scribe_items).toEqual(["no_clinically_relevant_omission", "no_invented_content"]);
    expect(v.second_review.required_on).toEqual(["critical_miss"]);
    expect(v.speak_up.checkin_days).toEqual([30, 90]);
    expect(v.speak_up.about_lead_routes_to).toBe("independent_reader");
  });
});
