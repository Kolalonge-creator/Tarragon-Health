import { describe, expect, it } from "@jest/globals";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { PROPOSED_CONFIG, getProposedConfig } from "@tarragon/shared";
import { SEED_PATHWAYS, categoryAtLeast, riskTighteningConfigSchema, type SymptomCapture } from "@tarragon/symptom-triage-engine";
import { degradedModeConfig, lagosMonth, runSymptomCheck } from "./safe-run";

const pathway = SEED_PATHWAYS.find((p) => p.key === "headache")!;
const capture = (p: Partial<SymptomCapture> = {}): SymptomCapture => ({
  presentingComplaintKey: "headache",
  onset: "gradual",
  severity: 2,
  associatedSymptoms: ["fever"],
  triggers: [],
  relevantHistory: [],
  measurements: {},
  ...p,
});
const decided = (category: "self_management" | "routine" | "urgent" | "emergency") => () => ({
  category,
  clinicianReviewRequired: false,
  safetyNetMessageKey: "headache.self_mild",
  rationale: "decided by a stand-in engine",
  redFlagScreen: { hasFlag: false, fired: [], brokenRules: [], topCategory: null },
  questionsAsked: [],
});
const signed = (over: Record<string, unknown> = {}) => ({
  entries: [
    {
      id: "synthetic",
      label: "Synthetic",
      provenance: { source: "unit test", note: "synthetic" },
      status: "signed_off",
      clinical_sign_off: { by: "Test CMO", at: "2026-10-07" },
      applies_when: { any_associated_symptom: ["fever"] },
      minimum_category: "urgent",
      ...over,
    },
  ],
});

describe("the shipped prevalence layer is inert until the CMO signs it", () => {
  it("every shipped entry parses, is a draft, has no sign-off and cannot change a result", async () => {
    const cfg = getProposedConfig("symptom.risk_tightening");
    expect(cfg.owner).toBe("CMO");
    expect(cfg.status).toBe("proposed");
    const parsed = riskTighteningConfigSchema.parse(cfg.value);
    expect(parsed.entries.length).toBeGreaterThanOrEqual(2);
    for (const e of parsed.entries) {
      expect(e.status).toBe("draft");
      expect(e.clinical_sign_off).toBeNull();
      expect(e.provenance.source.length).toBeGreaterThan(0); // a draft may carry a source, but never a sign-off
    }
    const base = await runSymptomCheck({ pathway, capture: capture(), answers: {}, state: "Lagos", now: new Date("2026-08-15T12:00:00Z") });
    expect(base.raisedByRisk).toEqual([]);
  });

  it("covers the risks a SIGNED pathway can ask about (S59b redraft: typhoid and sickle cell dropped, no signed pathway collects them)", () => {
    const entries = riskTighteningConfigSchema.parse(getProposedConfig("symptom.risk_tightening").value).entries;
    const ids = entries.map((e) => e.id).join(" ");
    for (const word of ["malaria", "lassa"]) expect(ids).toContain(word);
    // every entry's keys must be askable by a signed pathway, or it could never match
    const askable = new Set(SEED_PATHWAYS.flatMap((p) => [p.key, ...p.knownAssociatedSymptoms, ...p.knownHistory]));
    for (const e of entries) {
      for (const k of [...(e.applies_when.any_associated_symptom ?? []), ...(e.applies_when.any_history ?? []), ...(e.applies_when.complaint_keys ?? [])]) {
        expect(askable.has(k)).toBe(true);
      }
    }
  });
  it("names states for Lassa (never nationwide by accident) and carries a source on every entry", () => {
    const entries = riskTighteningConfigSchema.parse(getProposedConfig("symptom.risk_tightening").value).entries;
    const lassa = entries.find((e) => e.id === "lassa_season_fever");
    expect(lassa?.applies_when.states?.length).toBeGreaterThan(0);
    for (const e of entries) expect(e.provenance.source).toMatch(/^https:\/\//);
  });
});

describe("a signed entry raises a result and never lowers one", () => {
  it("raises a self-care result to urgent and asks for a human", async () => {
    const engine = decided("self_management");
    const plain = await runSymptomCheck({ pathway, capture: capture(), answers: {}, state: null, engine, riskConfig: { entries: [] } });
    const raised = await runSymptomCheck({ pathway, capture: capture(), answers: {}, state: null, engine, riskConfig: signed() });
    expect(categoryAtLeast(raised.category, plain.category)).toBe(true);
    expect(raised.category).toBe("urgent");
    expect(raised.raisedByRisk).toEqual(["synthetic"]);
    expect(raised.clinicianReviewRequired).toBe(true);
  });

  it("an entry whose minimum is below the result changes nothing (an emergency stays an emergency)", async () => {
    const em = capture({ presentingComplaintKey: "headache", onset: "sudden", severity: 9, associatedSymptoms: ["fever"] });
    const r = await runSymptomCheck({ pathway, capture: em, answers: {}, state: null, riskConfig: signed({ minimum_category: "routine" }) });
    expect(r.category).toBe("emergency");
    expect(r.raisedByRisk).toEqual([]);
  });

  it("the season is read in Africa/Lagos, not UTC", () => {
    expect(lagosMonth(new Date("2026-12-31T23:30:00Z"))).toBe(1);
    expect(lagosMonth(new Date("2026-06-15T12:00:00Z"))).toBe(6);
  });
});

describe("the degraded-mode config", () => {
  it("never lets an unclassifiable run fall below urgent, and has a bounded timeout", () => {
    const c = degradedModeConfig();
    expect(["urgent", "emergency"]).toContain(c.unclassifiable_category);
    expect(c.engine_timeout_ms).toBeGreaterThan(0);
    expect(c.engine_timeout_ms).toBeLessThanOrEqual(10000);
  });
  it("is a PROPOSED value awaiting the CMO, not a confirmed one", () => {
    expect(getProposedConfig("symptom.degraded_mode").status).toBe("proposed");
    expect(getProposedConfig("symptom.degraded_mode").owner).toBe("CMO");
  });
});

describe("symptom.accuracy_audit mirrors the migration seed", () => {
  it("is identical to the active symptom_accuracy_config row", () => {
    const dir = join(__dirname, "..", "..", "..", "..", "..", "supabase", "migrations");
    const file = readdirSync(dir).find((f) => f.endsWith("_s60_symptom_accuracy_audit.sql"));
    if (!file) throw new Error("S60 accuracy migration not found");
    const match = /accuracy-config-begin[\s\S]*?\$json\$([\s\S]*?)\$json\$/.exec(readFileSync(join(dir, file), "utf8"));
    if (!match?.[1]) throw new Error("accuracy config seed not found in the migration");
    expect(JSON.parse(match[1])).toEqual(getProposedConfig("symptom.accuracy_audit").value);
  });
  it("has a minimum cell size the database also enforces (at least 5) and a supported confidence level", () => {
    const v = getProposedConfig("symptom.accuracy_audit").value as { min_cell_size: number; confidence_level: number };
    expect(v.min_cell_size).toBeGreaterThanOrEqual(5);
    expect([0.9, 0.95, 0.99]).toContain(v.confidence_level);
  });
  it("the registry holds all three S60 keys", () => {
    for (const k of ["symptom.degraded_mode", "symptom.risk_tightening", "symptom.accuracy_audit"]) {
      expect(PROPOSED_CONFIG.some((e) => e.key === k)).toBe(true);
    }
  });
});
