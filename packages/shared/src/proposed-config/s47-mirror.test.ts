import { describe, expect, it } from "@jest/globals";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { getProposedConfig } from "./index";

const MIGRATIONS = join(fileURLToPath(new URL(".", import.meta.url)), "..", "..", "..", "..", "supabase", "migrations");

function mig(suffix: string): string {
  const file = readdirSync(MIGRATIONS).find((f) => f.endsWith(suffix));
  if (!file) throw new Error(`${suffix} not found`);
  return readFileSync(join(MIGRATIONS, file), "utf8");
}
const json = (sql: string, marker: string): unknown => {
  const m = new RegExp(`${marker}[\\s\\S]*?\\$json\\$([\\s\\S]*?)\\$json\\$`).exec(sql);
  if (!m?.[1]) throw new Error(`${marker} seed not found`);
  return JSON.parse(m[1]);
};

describe("S47 proposed config mirrors its migration seeds and stays proposed", () => {
  const screening = () => mig("_s47_risk_based_hiv_hcv_cervical_hpv_dna_packages.sql");

  it("screening.serology_rules is serology_rule_versions v3: HIV and hepatitis C risk-based, threshold unconfirmed, titre alone never sets immunity", () => {
    const seed = json(screening(), "serology-rules-v3-begin\\s*insert[^$]*") as {
      hiv: { riskBased: boolean; repeatMonths: number };
      hep_c: { riskBased: boolean };
      hep_b: { stopsWhenHbvStatus: string[]; reopensOnNewExposure: boolean };
      antiHbs: { thresholdMiuPerMl: number; thresholdStatus: string; numericTitreAloneSetsImmunity: boolean };
      riskCriteria: { hcv: string[]; hiv: string[] };
    };
    const e = getProposedConfig("screening.serology_rules");
    expect(seed).toEqual(e.value);
    expect(e.version).toBe(2);
    expect(e.status).toBe("proposed");
    expect(seed.hiv.riskBased && seed.hep_c.riskBased).toBe(true);
    expect(seed.hiv.repeatMonths).toBe(12);
    expect(seed.hep_b.stopsWhenHbvStatus).toEqual(["immune"]);
    expect(seed.hep_b.reopensOnNewExposure).toBe(true);
    expect(seed.antiHbs).toEqual({ thresholdMiuPerMl: 10, thresholdStatus: "proposed_unconfirmed", numericTitreAloneSetsImmunity: false });
    // the Nigeria FMOH 2016 list for hepatitis C, and the HIV wording
    expect(seed.riskCriteria.hcv).toEqual([
      "transfusion_or_transplant", "injecting_drug_use", "haemodialysis", "contact_with_infected_person", "healthcare_sharps_exposure",
      "liver_disease_or_raised_enzymes", "living_with_hiv", "tattoo_or_scarification", "men_who_have_sex_with_men", "sex_work", "prison_history",
    ]);
    expect(seed.riskCriteria.hiv).toEqual(["ongoing_risk", "sexually_active_adult"]);
  });

  it("screening.cervical_hpv_dna is the cervical rule of screening_rule_sets v3", () => {
    const sql = screening();
    const m = /code', 'cervical_smear'|when x ->> 'code' = 'cervical_smear' then \$json\$([\s\S]*?)\$json\$/.exec(sql);
    if (!m?.[1]) throw new Error("cervical rule not found");
    expect(JSON.parse(m[1])).toEqual(getProposedConfig("screening.cervical_hpv_dna").value);
    const v = getProposedConfig("screening.cervical_hpv_dna").value as { ageMilestones: number[]; excludeWhenHiv: boolean; method: string };
    expect(v.ageMilestones).toEqual([35, 45]);
    expect(v.excludeWhenHiv).toBe(true);
    expect(v.method).toBe("hpv_dna");
    expect(getProposedConfig("screening.cervical_hpv_dna").status).toBe("proposed");
  });

  it("risk.band_actions is the bandActions of risk_instrument_versions v2 and never says the app prescribes", () => {
    const seed = json(mig("_s47_share_view_cap_and_risk_band_actions.sql"), "risk-band-actions-begin");
    const e = getProposedConfig("risk.band_actions");
    expect(seed).toEqual(e.value);
    const v = e.value as { appPrescribes: boolean; thresholdsStatus: string; bands: Record<string, Record<string, unknown>> };
    expect(v.appPrescribes).toBe(false);
    expect(v.thresholdsStatus).toBe("unverified_against_who_pen_hearts");
    expect(Object.keys(v.bands)).toEqual(["lt5", "5to10", "10to20", "20to30", "ge30"]);
    expect(v.bands["lt5"]).toMatchObject({ reassessMonths: 12 });
    expect(v.bands["5to10"]).toMatchObject({ bpCheckEveryMonths: 6 });
    expect(v.bands["10to20"]).toMatchObject({ careTeamReviewWithinWeeks: 4, recheckEveryMonths: 3, doctorDecidesAboutMedicines: true });
    expect(v.bands["20to30"]).toMatchObject({ doctorReviewWithinWeeks: 2, recheckEveryMonths: 3 });
    expect(v.bands["ge30"]).toMatchObject({ doctorReviewWithinWeeks: 1 });
    expect(e.status).toBe("proposed");
  });

  it("handover.grace_days is the active handover_config row", () => {
    const sql = mig("_s47_handover_grace_period_and_auto_end.sql");
    const m = /values \(1, (\d+), array\[([\d, ]+)\]/.exec(sql);
    if (!m) throw new Error("handover_config seed not found");
    expect({ grace_days: Number(m[1]), notice_days: m[2]!.split(",").map((n) => Number(n.trim())) }).toEqual(getProposedConfig("handover.grace_days").value);
    expect((getProposedConfig("handover.grace_days").value as { grace_days: number }).grace_days).toBe(90);
    expect(getProposedConfig("handover.grace_days").status).toBe("proposed");
  });

  it("privacy.retention records the stance and leaves the retention period unconfirmed, not invented", () => {
    const e = getProposedConfig("privacy.retention");
    expect(e.value).toMatchObject({ stance: "anonymise_keep_clinical_record", retentionPeriodYears: null, retentionPeriodStatus: "unconfirmed", deletionRequest: "admin_reviewed" });
    expect(e.status).toBe("proposed");
  });

  it("consent.required_for_care is exactly what the migration leaves required", () => {
    const sql = mig("_s47_consent_matrix_optional_per_use.sql");
    expect(sql).toContain("data_type in ('reproductive', 'mental_health', 'device_data')");
    expect(getProposedConfig("consent.required_for_care").value).toEqual({
      requiredForCare: ["vitals", "documents"],
      optionalPerUse: ["reproductive", "mental_health", "device_data"],
      withdrawalStops: "that_feature_only",
    });
  });

  it("emergency_card.defaults agree with the migration column defaults", () => {
    const sql = mig("_s47_emergency_card_defaults.sql");
    expect(sql).toContain("alter column show_conditions set default false");
    expect(sql).toMatch(/add column show_reproductive\s+boolean not null default false/);
    expect(sql).toMatch(/add column show_mental_health boolean not null default false/);
    const v = getProposedConfig("emergency_card.defaults").value as { on: string[]; off: string[]; hiddenReads: string };
    expect(v.off).toEqual(["conditions", "reproductive", "mental_health"]);
    expect(v.on).toEqual(expect.arrayContaining(["blood", "allergies", "medications", "emergency_contact"]));
    expect(v.hiddenReads).toBe("not shared");
  });

  it("results.sensitive_code_patterns is the pattern table seed, and matches the variants the review named but not the immunity titre", () => {
    const sql = mig("_s47b_review_fixes.sql");
    const body = /sensitive-code-patterns-begin\n([\s\S]*?)-- sensitive-code-patterns-end/.exec(sql)?.[1] ?? "";
    const seed = [...body.matchAll(/\('([^']+)', '(hiv|hbv|hcv)'/g)].map((m) => ({ pattern: m[1], virus: m[2] }));
    const e = getProposedConfig("results.sensitive_code_patterns");
    expect(seed).toEqual(e.value);
    expect(e.status).toBe("proposed");
    const res = (e.value as { pattern: string }[]).map((p) => new RegExp(p.pattern));
    const sensitive = (code: string) => res.some((r) => r.test(code.toLowerCase()));
    for (const c of ["hiv", "hiv_rna", "hiv_p24", "hbsag", "hbs_ag", "hbv_dna", "hbeag", "anti_hbc", "hcv_rna", "anti_hcv", "hep_c", "hepatitis_b_core"]) expect(sensitive(c)).toBe(true);
    for (const c of ["anti_hbs", "hba1c", "alt", "creatinine"]) expect(sensitive(c)).toBe(false);
  });

  it("report.settings v2 matches higher-risk names only exactly: pre-diabetes, family history and heatstroke are excluded", () => {
    const v = getProposedConfig("report.settings").value as { higherRiskCriteria: { namePatterns: Record<string, string[]>; excludePatterns: string[] } };
    const hit = (kind: string, name: string) => {
      const n = name.toLowerCase().trim();
      if (v.higherRiskCriteria.excludePatterns.some((p) => new RegExp(p, "i").test(n))) return false;
      return v.higherRiskCriteria.namePatterns[kind]!.some((p) => new RegExp(p, "i").test(n));
    };
    expect(hit("diabetes", "Type 2 diabetes mellitus")).toBe(true);
    expect(hit("diabetes", "Pre-diabetes")).toBe(false);
    expect(hit("diabetes", "Family history of diabetes")).toBe(false);
    expect(hit("diabetes", "Gestational diabetes")).toBe(false);
    expect(hit("cvd", "Stroke")).toBe(true);
    expect(hit("cvd", "Heatstroke")).toBe(false);
    expect(hit("ckd", "Chronic kidney disease stage 3b")).toBe(true);
  });
});
