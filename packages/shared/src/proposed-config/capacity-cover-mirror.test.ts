import { describe, expect, it } from "@jest/globals";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { getProposedConfig } from "./index";

const MIGRATIONS = join(fileURLToPath(new URL(".", import.meta.url)), "..", "..", "..", "..", "supabase", "migrations");

function migrationSql(): string {
  const file = readdirSync(MIGRATIONS).find((f) => f.endsWith("_s16_s20_capacity_cover.sql"));
  if (!file) throw new Error("capacity and cover migration not found");
  return readFileSync(join(MIGRATIONS, file), "utf8");
}

function seeded(marker: string): Record<string, unknown> {
  const match = new RegExp(marker + "[\\s\\S]*?\\$json\\$([\\s\\S]*?)\\$json\\$").exec(migrationSql());
  if (!match?.[1]) throw new Error(`seed ${marker} not found in the migration`);
  return JSON.parse(match[1]) as Record<string, unknown>;
}

const SWITCHES = ["gate_enforce", "hard_rest_enforce", "drill_enabled"] as const;

describe("capacity.cover_rules mirrors the migration seed", () => {
  it("v1 is identical to the active capacity_cover_config row", () => {
    expect(seeded("capacity-cover-rules-begin")).toEqual(getProposedConfig("capacity.cover_rules").value);
  });

  it("v2 mirrors the inactive row and differs from v1 only in switching the three enforcing switches on", () => {
    const v1 = getProposedConfig("capacity.cover_rules").value as Record<string, unknown>;
    const v2 = getProposedConfig("capacity.cover_rules_v2").value as Record<string, unknown>;
    expect(seeded("capacity-cover-rules-v2-begin")).toEqual(v2);
    const flipped = { ...v2 };
    for (const k of SWITCHES) flipped[k] = 0;
    expect(flipped).toEqual(v1);
    for (const k of SWITCHES) {
      expect(v1[k]).toBe(0);
      expect(v2[k]).toBe(1);
    }
  });

  it("holds the 11 hour rest rule, the 90 percent within 5 minutes drill target and the 72 hour rota horizon", () => {
    const v = getProposedConfig("capacity.cover_rules").value as Record<string, number>;
    expect(v.rest_hours).toBe(11);
    expect(v.drill_ack_target_pct).toBe(90);
    expect(v.drill_ack_target_seconds).toBe(300);
    expect(v.rota_horizon_hours).toBe(72);
    expect(v.cover_offer_pages).toBe(2);
    expect(v.pause_confirm_minutes).toBe(240);
  });

  it("is proposed and owned by the CMO, never confirmed by the agent", () => {
    for (const key of ["capacity.cover_rules", "capacity.cover_rules_v2", "capacity.pilot_lead_cap"]) {
      const e = getProposedConfig(key);
      expect(e.owner).toBe("CMO");
      expect(e.status).toBe("proposed");
    }
  });
});

describe("capacity.pilot_lead_cap mirrors lead_config version 2", () => {
  it("is 40, the migration derives version 2 from version 1 with that number, and version 1 stays 60", () => {
    expect(getProposedConfig("capacity.pilot_lead_cap").value).toBe(40);
    const sql = migrationSql();
    const block = /lead-cap-pilot-begin([\s\S]*?)lead-cap-pilot-end/.exec(sql)?.[1] ?? "";
    expect(block).toContain("'{max_lead_patients}', '40'::jsonb");
    expect(block).toContain("select 2, false");
    expect(getProposedConfig("lead.rules").value).toMatchObject({ max_lead_patients: 60 });
  });
});
