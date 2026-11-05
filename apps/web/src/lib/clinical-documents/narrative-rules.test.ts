/** @jest-environment node */
import { describe, expect, it } from "@jest/globals";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { getProposedConfig } from "@tarragon/shared";
import { hashConfigValue } from "@/lib/go-live/model";
import cases from "./narrative-rules.cases.json";
import { draftNarrativeRules, matchNarrativeRules, pagingTierFor, type NarrativeFields } from "./narrative-rules";

describe("draft narrative urgent-finding rules (CDE-01, unsigned)", () => {
  it("is a PROPOSED rule set owned by the CMO", () => {
    expect(draftNarrativeRules().ecg_qtc_urgent_ms).toBe(500);
  });

  it("raises BI-RADS 0, 4 and above as printed, and not 1 to 3", () => {
    expect(matchNarrativeRules({ birads: ["1", "4A"] })).toEqual([{ rule: "birads", matched: "4A" }]);
    expect(matchNarrativeRules({ birads: ["0"] })).toHaveLength(1);
    expect(matchNarrativeRules({ birads: ["2", "3", null] })).toEqual([]);
  });

  it("raises high-grade cervical cytology and HPV 16 or 18, not NILM or other types", () => {
    expect(matchNarrativeRules({ cervicalCytology: "High-grade squamous intraepithelial lesion (HSIL)" })[0]?.rule).toBe("cervical_cytology");
    expect(matchNarrativeRules({ cervicalCytology: "Negative for intraepithelial lesion or malignancy (NILM)" })).toEqual([]);
    expect(matchNarrativeRules({ hpvGenotypes: "HPV 18 detected" })).toEqual([{ rule: "hpv_genotype", matched: "18" }]);
    expect(matchNarrativeRules({ hpvGenotypes: "Other high-risk types (31, 33)" })).toEqual([]);
  });

  it("raises a malignancy term in a diagnosis line but not a negated one", () => {
    expect(matchNarrativeRules({ pathologyDiagnosis: "Invasive ductal carcinoma, grade 2" })[0]?.matched).toBe("carcinoma");
    expect(matchNarrativeRules({ pathologyDiagnosis: "Benign. No evidence of malignancy." })).toEqual([]);
    expect(matchNarrativeRules({ pathologyDiagnosis: "Negative for malignancy" })).toEqual([]);
  });

  it("raises listed ECG statements and a QTc of 500 ms or more", () => {
    expect(matchNarrativeRules({ ecgInterpretation: "Sinus rhythm. ST elevation in V1-V4." })[0]?.matched).toBe("st elevation");
    expect(matchNarrativeRules({ ecgInterpretation: "Sinus rhythm. Normal ECG.", ecgQtcMs: 499 })).toEqual([]);
    expect(matchNarrativeRules({ ecgQtcMs: 512 })).toEqual([{ rule: "ecg_qtc", matched: "QTc 512 ms" }]);
  });

  it("raises a critical radiology finding and ignores one that is ruled out", () => {
    expect(matchNarrativeRules({ imagingImpression: "Large right pneumothorax." })[0]?.matched).toBe("pneumothorax");
    expect(matchNarrativeRules({ imagingImpression: "No pneumothorax. No free air." })).toEqual([]);
    expect(matchNarrativeRules({ imagingImpression: "Pulmonary embolism excluded." })).toEqual([]);
  });

  it("does not let a negation elsewhere hide a finding (the safe direction)", () => {
    expect(matchNarrativeRules({ pathologyDiagnosis: "Lesion is not benign; carcinoma present" })[0]?.matched).toBe("carcinoma");
    expect(matchNarrativeRules({ pathologyDiagnosis: "No change since the previous biopsy, which showed carcinoma" })[0]?.matched).toBe("carcinoma");
    expect(matchNarrativeRules({ imagingImpression: "No effusion. Right pneumothorax." })[0]?.matched).toBe("pneumothorax");
    expect(matchNarrativeRules({ pathologyDiagnosis: "No change in the known carcinoma" })[0]?.matched).toBe("carcinoma");
    expect(matchNarrativeRules({ pathologyDiagnosis: "No residual carcinoma" })).toEqual([]);
  });
});

describe("paging tier per rule (CMO decision 2026-11-04, CDE-09)", () => {
  it("covers every rule, with acute ECG and radiology at the critical tier and cancer findings at the non-critical abnormal tier", () => {
    expect(draftNarrativeRules().paging_tier_by_rule).toEqual({
      birads: "urgent_escalation",
      cervical_cytology: "urgent_escalation",
      hpv_genotype: "urgent_escalation",
      pathology: "urgent_escalation",
      ecg: "emergency",
      ecg_qtc: "emergency",
      imaging: "emergency",
    });
  });

  it("keeps the decided rows: HPV 16/18 urgent, BI-RADS 0 urgent, QTc 500 ms", () => {
    const rules = draftNarrativeRules();
    expect(rules.hpv_genotypes_urgent).toEqual(["16", "18"]);
    expect(rules.birads_urgent).toContain("0");
    expect(rules.ecg_qtc_urgent_ms).toBe(500);
  });

  it("returns no tier without a match, the critical tier when any acute rule matched, otherwise the non-critical tier", () => {
    const rules = draftNarrativeRules();
    expect(pagingTierFor([], rules)).toBeNull();
    expect(pagingTierFor(matchNarrativeRules({ pathologyDiagnosis: "Invasive ductal carcinoma" }), rules)).toBe("urgent_escalation");
    expect(pagingTierFor(matchNarrativeRules({ ecgQtcMs: 512 }), rules)).toBe("emergency");
    expect(
      pagingTierFor(matchNarrativeRules({ pathologyDiagnosis: "carcinoma", imagingImpression: "Right-sided pneumothorax" }), rules),
    ).toBe("emergency");
  });

  it("pages at the critical tier when a rule's tier is missing or mistyped, never lower", () => {
    const base = draftNarrativeRules();
    const typo = { ...base, paging_tier_by_rule: { ...base.paging_tier_by_rule, pathology: "critical" } } as unknown as typeof base;
    expect(pagingTierFor(matchNarrativeRules({ pathologyDiagnosis: "carcinoma" }), typo)).toBe("emergency");
    const missing = { ...base, paging_tier_by_rule: {} } as unknown as typeof base;
    expect(pagingTierFor(matchNarrativeRules({ pathologyDiagnosis: "carcinoma" }), missing)).toBe("emergency");
  });
});

// CDE-10: the rules act in the database (private.match_narrative_rules). These keep the three copies identical: the registry value the
// CMO confirmed, the copy the migration loads, and the shared cases both matchers are checked against.
const repo = join(__dirname, "../../../../..");
const migration = (): string => {
  const dir = join(repo, "supabase/migrations");
  const file = readdirSync(dir).find((f) => f.endsWith("_cde10_apply_narrative_urgent_rules.sql"));
  if (!file) throw new Error("cde10 migration not found");
  return readFileSync(join(dir, file), "utf8");
};

describe("narrative rules in the database (CDE-10)", () => {
  it("passes every shared case with the app matcher", () => {
    for (const c of cases as Array<{ name: string; fields: NarrativeFields; expected: unknown }>) {
      expect({ name: c.name, got: matchNarrativeRules(c.fields, draftNarrativeRules()) }).toEqual({ name: c.name, got: c.expected });
    }
  });

  it("loads exactly the registry value, with the fingerprint the CMO confirmed", () => {
    const sql = migration();
    const m = /values \(1, '(.+)'::jsonb, '([0-9a-f]{64})'\);/.exec(sql);
    expect(m).not.toBeNull();
    const value = getProposedConfig("documents.narrative_urgent_rules").value;
    expect(JSON.parse(m![1]!.replace(/''/g, "'"))).toEqual(value);
    expect(m![2]).toBe(hashConfigValue(value));
  });

  it("runs the same cases in the database proof", () => {
    const proof = readFileSync(join(repo, "packages/db/tests/cde10_apply_narrative_urgent_rules.sql"), "utf8");
    const m = /-- CASES-BEGIN\n\s*v_cases jsonb := '(.+)'::jsonb;\n\s*-- CASES-END/.exec(proof);
    expect(m).not.toBeNull();
    expect(JSON.parse(m![1]!.replace(/''/g, "'"))).toEqual(cases);
  });
});
