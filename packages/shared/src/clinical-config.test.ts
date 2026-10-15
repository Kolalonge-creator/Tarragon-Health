import { describe, expect, it } from "@jest/globals";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  CLINICAL_CONFIG_KINDS,
  CLINICAL_CONFIG_CONTENT_SCHEMAS,
  clinicalConfigSignState,
  clinicalConfigSourcesSchema,
  isHighRiskClinicalConfigKind,
  parseClinicalConfigContent,
  requiredUnsuppliedFields,
  type ClinicalConfigKind,
  type IndependentClinicalReviewRow,
} from "./clinical-config";

const MIGRATIONS = join(fileURLToPath(new URL(".", import.meta.url)), "..", "..", "..", "supabase", "migrations");

/** The seeded content/sources for each kind, read from the S88 migration so the schema cannot drift from it. */
function seeds(): Record<string, { content: unknown; sources: unknown }> {
  const file = readdirSync(MIGRATIONS).find((f) => f.endsWith("_s88_clinical_config_drafts.sql"));
  if (!file) throw new Error("S88 migration not found");
  const sql = readFileSync(join(MIGRATIONS, file), "utf8");
  const out: Record<string, { content: unknown; sources: unknown }> = {};
  const re = /\('([a-z0-9_]+)', 1, \$json\$([\s\S]*?)\$json\$, \$json\$([\s\S]*?)\$json\$/g;
  for (const m of sql.matchAll(re)) {
    out[m[1]] = { content: JSON.parse(m[2]), sources: JSON.parse(m[3]) };
  }
  return out;
}

const review = (id: string, outcome: IndependentClinicalReviewRow["outcome"]): IndependentClinicalReviewRow => ({
  id: "11111111-1111-4111-8111-111111111111",
  config_version_id: id,
  reviewer_name: "Dr R",
  mdcn_number: "MDCN/1",
  reviewed_at: "2026-10-08T00:00:00Z",
  outcome,
  note: null,
});

describe("S88 clinical config content shapes", () => {
  const all = seeds();

  it("seeds all six kinds", () => {
    expect(Object.keys(all).sort()).toEqual([...CLINICAL_CONFIG_KINDS].sort());
  });

  it.each(CLINICAL_CONFIG_KINDS)("the %s seed passes its schema and has sources", (kind) => {
    expect(parseClinicalConfigContent(kind, all[kind].content)).toBe(true);
    expect(clinicalConfigSourcesSchema.safeParse(all[kind].sources).success).toBe(true);
  });

  it("a malformed row is rejected, not rendered as complete", () => {
    const bad = { ...(all.aggregate_reporting_small_cell.content as Record<string, unknown>), min_cell: "ten" };
    expect(parseClinicalConfigContent("aggregate_reporting_small_cell", bad)).toBe(false);
    expect(CLINICAL_CONFIG_CONTENT_SCHEMAS.field_nurse_visit_scope.safeParse({}).success).toBe(false);
  });

  it("values the pack leaves to the CMO stay null, never invented", () => {
    const glp = all.glp1_readiness_protocol.content as { entry: Record<string, unknown>; monitoring: Record<string, unknown> };
    expect(glp.entry.ancestry_specific_lower_bmi_cutoffs).toBeNull();
    expect(glp.monitoring.stop_and_review_rule).toBeNull();
    const htn = all.hypertension_care_gap_rules.content as { risk_score: Record<string, unknown> };
    expect(htn.risk_score.who_2019_cvd_chart_coefficients).toBeNull();
  });

  it("carries the pack's numbers exactly", () => {
    expect((all.aggregate_reporting_small_cell.content as { min_cell: number; employer_min_enrolled: number }).min_cell).toBe(10);
    expect((all.aggregate_reporting_small_cell.content as { employer_min_enrolled: number }).employer_min_enrolled).toBe(50);
    const dm = all.diabetes_targets_and_triggers.content as {
      hba1c_target: { default_below_percent: number };
      triggers: { home_fasting_glucose_above: { mmol_l: number }; reading_below_same_day_review: { mmol_l: number }; reading_below_urgent_triage: { mmol_l: number } };
    };
    expect(dm.hba1c_target.default_below_percent).toBe(7.0);
    expect(dm.triggers.home_fasting_glucose_above.mmol_l).toBe(7.2);
    expect(dm.triggers.reading_below_same_day_review.mmol_l).toBe(3.9);
    expect(dm.triggers.reading_below_urgent_triage.mmol_l).toBe(3.0);
    const ai = all.ai_copilot_acceptable_use.content as { shadow_mode: { min_weeks: number; min_reviewed_drafts: number } };
    expect([ai.shadow_mode.min_weeks, ai.shadow_mode.min_reviewed_drafts]).toEqual([8, 200]);
  });
});

describe("clinicalConfigSignState", () => {
  const glpContent = (rule: string | null) => ({ monitoring: { stop_and_review_rule: rule }, entry: { ancestry_specific_lower_bmi_cutoffs: null } });
  // Sources confirmed and the required field supplied, so each test isolates one guard.
  const draft = (kind: ClinicalConfigKind) => ({
    id: "row-1",
    config_kind: kind,
    version: 1,
    status: "draft" as const,
    verify_against_source: false,
    content: kind === "glp1_readiness_protocol" ? glpContent("TEST ONLY") : {},
  });

  it("refuses while the sources are unconfirmed, naming the guard", () => {
    const s = clinicalConfigSignState({ ...draft("field_nurse_visit_scope"), verify_against_source: true }, [], null);
    expect(s).toEqual({ canSign: false, reason: expect.stringContaining("confirm the source documents") });
  });

  it("refuses while a required CMO-to-supply field is null, but not for the optional nulls", () => {
    const blocked = clinicalConfigSignState({ ...draft("glp1_readiness_protocol"), content: glpContent(null) }, [review("row-1", "approved")], null);
    expect(blocked).toEqual({ canSign: false, reason: expect.stringContaining("monitoring.stop_and_review_rule") });
    expect(requiredUnsuppliedFields("glp1_readiness_protocol", glpContent("x"))).toEqual([]);
    expect(requiredUnsuppliedFields("hypertension_care_gap_rules", { risk_score: { who_2019_cvd_chart_coefficients: null } })).toEqual([]);
  });

  it("the seeded GLP-1 row has exactly one required gap and the hypertension row none", () => {
    expect(requiredUnsuppliedFields("glp1_readiness_protocol", seeds().glp1_readiness_protocol.content)).toEqual(["monitoring.stop_and_review_rule"]);
    expect(requiredUnsuppliedFields("hypertension_care_gap_rules", seeds().hypertension_care_gap_rules.content)).toEqual([]);
  });

  it("classifies high and medium risk kinds as the pack does", () => {
    expect(CLINICAL_CONFIG_KINDS.filter(isHighRiskClinicalConfigKind).sort()).toEqual(
      ["ai_copilot_acceptable_use", "diabetes_targets_and_triggers", "glp1_readiness_protocol", "hypertension_care_gap_rules"].sort(),
    );
  });

  it("refuses a high-risk draft with no review, with the reason", () => {
    const s = clinicalConfigSignState(draft("glp1_readiness_protocol"), [], null);
    expect(s).toEqual({ canSign: false, reason: expect.stringContaining("independent clinical review") });
  });

  it("a changes_requested review or another version's review does not unlock", () => {
    expect(clinicalConfigSignState(draft("glp1_readiness_protocol"), [review("row-1", "changes_requested")], null).canSign).toBe(false);
    expect(clinicalConfigSignState(draft("glp1_readiness_protocol"), [review("other", "approved")], null).canSign).toBe(false);
  });

  it("an approved review of this exact version unlocks a high-risk kind", () => {
    expect(clinicalConfigSignState(draft("glp1_readiness_protocol"), [review("row-1", "approved")], null).canSign).toBe(true);
  });

  it("a medium-risk kind needs no review", () => {
    expect(clinicalConfigSignState(draft("field_nurse_visit_scope"), [], null).canSign).toBe(true);
  });

  it("refuses a version older than one already signed, and anything not a draft", () => {
    expect(clinicalConfigSignState({ ...draft("field_nurse_visit_scope"), version: 1 }, [], 2).canSign).toBe(false);
    expect(clinicalConfigSignState({ ...draft("field_nurse_visit_scope"), status: "active" }, [], null).canSign).toBe(false);
  });
});
