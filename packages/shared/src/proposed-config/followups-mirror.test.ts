import { describe, expect, it } from "@jest/globals";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { getProposedConfig } from "./index";

const MIGRATIONS = join(fileURLToPath(new URL(".", import.meta.url)), "..", "..", "..", "..", "supabase", "migrations");

function migrationSql(): string {
  const file = readdirSync(MIGRATIONS).find((f) => f.endsWith("_two_tier_followup_data_model_and_config.sql"));
  if (!file) throw new Error("two-tier follow-up migration not found");
  return readFileSync(join(MIGRATIONS, file), "utf8");
}

function seed(marker: string): unknown {
  const re = new RegExp(`-- ${marker}-begin[\\s\\S]*?\\$json\\$([\\s\\S]*?)\\$json\\$`);
  const match = re.exec(migrationSql());
  if (!match?.[1]) throw new Error(`${marker} seed not found in the migration`);
  return JSON.parse(match[1]);
}

describe("consultations.call_length mirrors followup_config call_length version 1", () => {
  it("is identical to the migration seed", () => {
    expect(seed("call-length-v1")).toEqual(getProposedConfig("consultations.call_length").value);
  });

  it("holds the CMO's decision C8: 20 minutes for need and the yearly results call, 15 routine, 10 the shortest routine", () => {
    const v = getProposedConfig<{
      routineMinutes: number;
      routineMinMinutes: number;
      longMinutes: number;
      yearlyResultsMinutes: number;
      abnormalLookbackDays: number;
    }>("consultations.call_length").value;
    expect(v.longMinutes).toBe(20);
    expect(v.yearlyResultsMinutes).toBe(20);
    expect(v.routineMinutes).toBe(15);
    expect(v.routineMinMinutes).toBe(10);
    expect(v.abnormalLookbackDays).toBe(90);
  });

  it("is proposed, owned by the CMO, and never confirmed by code", () => {
    const e = getProposedConfig("consultations.call_length");
    expect(e.status).toBe("proposed");
    expect(e.owner).toBe("CMO");
  });
});

describe("followups.policy mirrors followup_config offers version 1", () => {
  it("is identical to the migration seed", () => {
    expect(seed("followups-v1")).toEqual(getProposedConfig("followups.policy").value);
  });

  it("holds the documented policy: 12 months, no stockpile, 2 to 6 times", () => {
    const v = getProposedConfig<{ entitlementMonths: number; carryOverMonths: number; minSlots: number; maxSlots: number }>("followups.policy").value;
    expect(v.entitlementMonths).toBe(12);
    expect(v.carryOverMonths).toBe(0);
    expect(v.minSlots).toBe(2);
    expect(v.maxSlots).toBe(6);
  });

  it("the drift test discriminates: a changed value would not match", () => {
    const changed = { ...(seed("call-length-v1") as Record<string, unknown>), longMinutes: 25 };
    expect(changed).not.toEqual(getProposedConfig("consultations.call_length").value);
  });
});
