import { describe, expect, it } from "@jest/globals";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { getProposedConfig, PROPOSED_CONFIG } from "./index";

const MIGRATIONS = join(fileURLToPath(new URL(".", import.meta.url)), "..", "..", "..", "..", "supabase", "migrations");

type Rule = {
  enabled: boolean;
  owner_role: "care_coordinator" | "clinician";
  patient_ladder: boolean;
  source: string;
  cmo_to_supply?: string[];
  hypertension_days_without_reading?: number | null;
  diabetes_days_without_reading?: number | null;
  lookback_days?: number;
  grace_days?: number;
  min_rise_systolic_mmhg?: number | null;
  cmo_to_confirm?: string[];
  exclude_drug_name_patterns?: string[];
  exclude_indication_patterns?: string[];
};
type CareGapRules = {
  verify_against_source: boolean;
  scope: { members_only: boolean; exclude_minors: boolean; conditions: string[] };
  rules: Record<string, Rule>;
  ladder: {
    steps: string[];
    days_between_steps: number;
    weekly_cap_per_patient: number;
    quiet_hours: { start: string; end: string };
    coordinator_followup_days: number;
    unreachable_after_staff_attempts: number;
    reopen_after_manual_close_days: number;
    doctor_review_days: number;
    recheck_after_hours: number;
  };
  ab: { enabled: boolean; outcome_days: number; experiments: { key: string; variants: (string | number)[] }[] };
  notifications: { template_first: string; template_followup: string; rule: string };
};

describe("care_gaps.rules mirrors the migration seed (S90)", () => {
  const file = readdirSync(MIGRATIONS).find((f) => f.endsWith("_s90_care_gap_rule_engine.sql"));
  if (!file) throw new Error("S90 migration not found");
  const sql = readFileSync(join(MIGRATIONS, file), "utf8");
  const cfg = getProposedConfig<CareGapRules>("care_gaps.rules");

  it("is identical to the care_gap_rule_config v1 seed", () => {
    const match = /care-gap-rules-v1-begin[\s\S]*?\$json\$([\s\S]*?)\$json\$/.exec(sql);
    if (!match?.[1]) throw new Error("care gap seed not found in the migration");
    expect(JSON.parse(match[1])).toEqual(cfg.value);
  });

  it("is PROPOSED and owned by the CMO, never signed in code", () => {
    const e = PROPOSED_CONFIG.find((x) => x.key === "care_gaps.rules");
    expect(e?.status).toBe("proposed");
    expect(e?.owner).toBe("CMO");
  });

  it("the migration seeds it unsigned and inactive, and nothing in the seed signs or switches anything on", () => {
    expect(sql).toMatch(/values \(1, false, '2026-10-27'/);
    const seedPart = sql.slice(sql.indexOf("care-gap-rules-v1-begin"), sql.indexOf("care-gap-rules-v1-end"));
    expect(seedPart).not.toMatch(/approved_at|is_active\s*=\s*true/);
    // the guard is inserted with is_on left at its default (off); no statement in the file sets it on
    expect(sql).not.toMatch(/update public\.go_live_guards/i);
    expect(sql).not.toMatch(/set_go_live_guard\s*\(/i);
  });

  it("takes the hypertension lines from decision pack item 4.2 and invents no clinical number", () => {
    // 14 = the uncontrolled cadence (7) plus the overdue allowance (7); the lab lines are the 12 month annual labs and the 30 day overdue line
    expect(cfg.value.rules.missed_reading?.hypertension_days_without_reading).toBe(14);
    for (const k of ["no_hba1c_12_months", "no_lipids_12_months"]) {
      expect(cfg.value.rules[k]?.lookback_days).toBe(365);
      expect(cfg.value.rules[k]?.grace_days).toBe(30);
    }
    // the two numbers the pack does not give stay null and are listed as the CMO's to supply
    expect(cfg.value.rules.missed_reading?.diabetes_days_without_reading).toBeNull();
    expect(cfg.value.rules.missed_reading?.cmo_to_supply).toEqual(["diabetes_days_without_reading"]);
    expect(cfg.value.rules.rising_bp_trend?.min_rise_systolic_mmhg).toBeNull();
    expect(cfg.value.rules.rising_bp_trend?.cmo_to_supply).toEqual(["min_rise_systolic_mmhg"]);
    expect(cfg.value.verify_against_source).toBe(true);
  });

  it("routes a judgement item to a doctor and logistics to a coordinator, and a trend never messages the patient", () => {
    expect(cfg.value.rules.rising_bp_trend?.owner_role).toBe("clinician");
    expect(cfg.value.rules.rising_bp_trend?.patient_ladder).toBe(false);
    for (const k of ["missed_reading", "no_hba1c_12_months", "no_lipids_12_months", "medication_refill_lapse", "adherence_lapse"]) {
      expect(cfg.value.rules[k]?.owner_role).toBe("care_coordinator");
    }
  });

  it("the ladder is push, in-app, email, then a coordinator call, with a cap and Lagos quiet hours", () => {
    expect(cfg.value.ladder.steps).toEqual(["push", "in_app", "email", "coordinator_call"]);
    expect(cfg.value.ladder.weekly_cap_per_patient).toBeGreaterThanOrEqual(1);
    expect(cfg.value.ladder.quiet_hours).toEqual({ start: "20:00", end: "08:00" });
    expect(cfg.value.ladder.reopen_after_manual_close_days).toBeGreaterThanOrEqual(1);
  });

  it("the doctor review clock and the recheck period are config, and the adherence scope lists are the CMO's to confirm", () => {
    expect(cfg.value.ladder.doctor_review_days).toBeGreaterThanOrEqual(1);
    expect(cfg.value.ladder.recheck_after_hours).toBeGreaterThanOrEqual(1);
    const adherence = cfg.value.rules.adherence_lapse;
    expect((adherence?.exclude_drug_name_patterns ?? []).length).toBeGreaterThan(0);
    expect((adherence?.exclude_indication_patterns ?? []).length).toBeGreaterThan(0);
    expect(adherence?.cmo_to_confirm).toEqual(["exclude_drug_name_patterns", "exclude_indication_patterns"]);
    // the controlled-patient cadence question is recorded for the CMO, not decided in code
    expect(cfg.value.rules.missed_reading?.cmo_to_confirm).toEqual(["hypertension_days_without_reading"]);
  });

  it("no experiment is switched on", () => {
    expect(cfg.value.ab.enabled).toBe(false);
    expect(cfg.value.ab.experiments.map((e) => e.key)).toEqual(["copy_variant", "send_hour"]);
  });

  it("uses the two neutral templates the migration registers", () => {
    expect(cfg.value.notifications.template_first).toBe("care_gap_checkin");
    expect(cfg.value.notifications.template_followup).toBe("care_gap_checkin_followup");
    for (const key of ["care_gap_checkin", "care_gap_checkin_followup"]) expect(sql).toContain(`'${key}'`);
  });

  it("no em dash appears in any shown text", () => {
    expect(JSON.stringify(cfg.value)).not.toMatch(/—/);
  });
});
