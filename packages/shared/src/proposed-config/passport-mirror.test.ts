import { describe, expect, it } from "@jest/globals";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { getProposedConfig } from "./index";

const MIGRATIONS = join(fileURLToPath(new URL(".", import.meta.url)), "..", "..", "..", "..", "supabase", "migrations");
const SCHEDULE_MIGRATION = "20261007230645_s43_biomarker_trends_and_vaccination_schedule.sql";

function seededSchedule(): { status: string; doses: Record<string, unknown>[]; excluded: { code: string }[] } {
  const sql = readFileSync(join(MIGRATIONS, SCHEDULE_MIGRATION), "utf8");
  const m = /immunisation-schedule-v2-begin\s*\$json\$([\s\S]*?)\$json\$/.exec(sql);
  if (!m?.[1]) throw new Error("immunisation schedule seed not found");
  return JSON.parse(m[1]);
}

describe("immunisation.schedule mirrors the draft sign-off row", () => {
  it("is identical, so the registry and vaccination_schedule_signoffs version 2 cannot drift", () => {
    expect(seededSchedule()).toEqual(getProposedConfig("immunisation.schedule").value);
  });

  it("is an UNSIGNED proposal owned by the CMO, never confirmed by an agent", () => {
    const e = getProposedConfig("immunisation.schedule");
    expect(e.status).toBe("proposed");
    expect(e.owner).toBe("CMO");
    expect((e.value as { status: string }).status).toBe("draft_unsigned");
  });

  it("holds the founder decisions: HPV is two doses six months apart, typhoid is not in the schedule", () => {
    const v = getProposedConfig("immunisation.schedule").value as { doses: Record<string, unknown>[]; excluded: { code: string }[] };
    const hpv = v.doses.find((d) => d.vaccine === "HPV");
    expect(hpv).toMatchObject({ dose_count: 2, dose_interval_weeks: 26 });
    expect(v.doses.some((d) => d.catalog_code === "typhoid")).toBe(false);
    expect(v.excluded.map((x) => x.code)).toContain("typhoid");
  });

  it("makes R21 malaria a per-state rollout, never a national rule", () => {
    const v = getProposedConfig("immunisation.schedule").value as { doses: Record<string, unknown>[] };
    expect(v.doses.find((d) => d.vaccine === "R21 malaria")).toMatchObject({ per_state_rollout: true });
  });

  it("marks every dose that is not verified against a dated national table", () => {
    const v = getProposedConfig("immunisation.schedule").value as { doses: { evidence: string }[] };
    for (const d of v.doses) expect(["V", "NV", "SEC"]).toContain(d.evidence);
  });
});
