import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it, expect } from "@jest/globals";
import { runTriage } from "../engine/index";
import { createInHouseEngine } from "../adapter/in-house-engine";
import { createSafeEngine } from "../adapter/symptom-engine";
import { CONTRACT_DEFAULT_CONFIG } from "../adapter/contract-suite";
import { EMPTY_CONTEXT } from "../safety/context-tightening";
import { applyRiskTightening } from "../safety/risk-tightening";
import { evaluateBundledRedFlags } from "../safety/bundled-red-flags";
import {
  TRIAGE_CATEGORIES,
  categoryAtLeast,
  parseTriageProtocolConfig,
  type AnswerMap,
  type PresentingComplaintProtocol,
  type SymptomCapture,
  type TriageCategory,
} from "../types/index";
import { S59D_DRAFT_PATHWAYS, S59D_DRAFT_VOCABULARY, S59D_PATHWAY_KEYS } from "./s59d-drafts";
import { PAEDIATRIC_DRAFT_PATHWAYS } from "./paediatric-drafts";
import { SEED_PATHWAYS } from "./index";
import { isLiveProtocolRow, liveProtocolConfig, livePathways, selectLivePathway, type StoredTriageProtocolRow } from "./live-guard";

const MIGRATIONS = join(fileURLToPath(new URL(".", import.meta.url)), "..", "..", "..", "..", "supabase", "migrations");
const migration = (suffix: string): string => {
  const file = readdirSync(MIGRATIONS).find((f) => f.endsWith(suffix));
  if (!file) throw new Error(`migration ending ${suffix} not found`);
  return readFileSync(join(MIGRATIONS, file), "utf8");
};

const cap = (p: Partial<SymptomCapture> & Pick<SymptomCapture, "presentingComplaintKey">): SymptomCapture => ({
  onset: "gradual",
  severity: 4,
  associatedSymptoms: [],
  triggers: [],
  relevantHistory: [],
  measurements: {},
  ...p,
});
const path = (key: string): PresentingComplaintProtocol => {
  const p = S59D_DRAFT_PATHWAYS.find((x) => x.key === key);
  if (!p) throw new Error(`no S59d pathway ${key}`);
  return p;
};
const category = (key: string, p: Partial<SymptomCapture>, answers: AnswerMap = {}): TriageCategory => runTriage(path(key), cap({ presentingComplaintKey: key, ...p }), answers).category;

describe("S59d draft pathways: shape", () => {
  it("parse through the load boundary, no dangling node, every rule key is namespaced, no red flag below urgent, no walk outcome is an emergency", () => {
    for (const p of S59D_DRAFT_PATHWAYS) {
      expect(parseTriageProtocolConfig({ version: 99, pathways: [p] })).not.toBeNull();
      const keys = new Set(Object.keys(p.nodes));
      expect(keys.has(p.startNodeKey)).toBe(true);
      for (const n of Object.values(p.nodes)) {
        if (n.type === "question") {
          for (const k of n.kind === "boolean" ? [n.onYes, n.onNo] : n.options.map((o) => o.next)) expect(keys.has(k)).toBe(true);
        } else {
          // A walk outcome is never an emergency: an emergency comes only from a red flag, which runs first and is final.
          expect(n.category).not.toBe("emergency");
        }
      }
      expect(categoryAtLeast(p.fallbackOutcome.category, "urgent")).toBe(true);
      expect(p.fallbackOutcome.clinicianReviewRequired).toBe(true);
      for (const r of p.redFlagScreen) {
        expect(r.key.startsWith(`${p.key}.`)).toBe(true);
        expect(categoryAtLeast(r.category, "urgent")).toBe(true);
      }
      expect(new Set(p.redFlagScreen.map((r) => r.key)).size).toBe(p.redFlagScreen.length);
    }
  });

  it("only the adult fever pathway can end in self-care, and only after a negative malaria test; the other three never can", () => {
    for (const p of S59D_DRAFT_PATHWAYS) {
      const outcomes = Object.values(p.nodes).filter((n) => n.type === "outcome");
      if (p.key !== "fever") for (const o of outcomes) expect(categoryAtLeast(o.category, "routine")).toBe(true);
    }
    // Every walk through fever: self-care appears only when the malaria test was done and was negative.
    const fever = path("fever");
    const answerSets: AnswerMap[] = [];
    for (const dur of [true, false]) for (const hyd of [true, false]) for (const sev of ["mild", "moderate", "high"]) for (const tested of [true, false]) for (const pos of [true, false])
      answerSets.push({ duration_check: dur, hydration_check: hyd, severity_check: sev, mild_test_check: tested, mild_result_check: pos, moderate_test_check: tested, moderate_result_check: pos });
    for (const a of answerSets) {
      const r = runTriage(fever, cap({ presentingComplaintKey: "fever" }), a);
      if (r.category === "self_management") expect(a.severity_check === "mild" && a.mild_test_check === true && a.mild_result_check === false && a.duration_check === false && a.hydration_check === true).toBe(true);
    }
    // an untested fever never ends in self-care or an "all clear"
    const untested = runTriage(fever, cap({ presentingComplaintKey: "fever" }), { duration_check: false, hydration_check: true, severity_check: "mild", mild_test_check: false });
    expect(untested.category).toBe("routine");
    // MEDIUM 3: a very unwell person who has not been tested, with no red flag ticked, is urgent (the v2 draft said urgent), never "get tested"
    const unwellUntested = runTriage(fever, cap({ presentingComplaintKey: "fever" }), { duration_check: false, hydration_check: true, severity_check: "high" });
    expect(unwellUntested.category).toBe("urgent");
    expect(unwellUntested.clinicianReviewRequired).toBe(true);
    // a moderate fever, tested and negative, is routine; untested is routine get-tested; tested and positive is urgent
    expect(runTriage(fever, cap({ presentingComplaintKey: "fever" }), { duration_check: false, hydration_check: true, severity_check: "moderate", moderate_test_check: true, moderate_result_check: false }).category).toBe("routine");
    expect(runTriage(fever, cap({ presentingComplaintKey: "fever" }), { duration_check: false, hydration_check: true, severity_check: "moderate", moderate_test_check: true, moderate_result_check: true }).category).toBe("urgent");
  });

  it("the fever pathway keeps every rule key of the v2 draft and every v2 node key", () => {
    const v2 = migration("_symptom_triage_protocols_draft_v2_fever_abdominal_pain.sql");
    const feverBlock = v2.slice(v2.indexOf('"key": "fever"'), v2.indexOf('"key": "abdominal_pain"'));
    const v2RuleKeys = [...feverBlock.matchAll(/\{"key": "(fever\.[a-z_]+)"/g)].map((m) => m[1]!);
    expect(v2RuleKeys.length).toBeGreaterThanOrEqual(8);
    const mine = new Set(path("fever").redFlagScreen.map((r) => r.key));
    for (const k of v2RuleKeys) expect(mine.has(k)).toBe(true);
    // and none of the v2 categories got LOWER
    const v2Cat = new Map([...feverBlock.matchAll(/\{"key": "(fever\.[a-z_]+)"[^}]*"category": "([a-z_]+)"/g)].map((m) => [m[1]!, m[2]!] as const));
    for (const r of path("fever").redFlagScreen) {
      const old = v2Cat.get(r.key);
      if (old) expect(categoryAtLeast(r.category, old as TriageCategory)).toBe(true);
    }
  });

  it("are UNSIGNED drafts: not in the bundled signed floor and never a pathway the signed seed has", () => {
    const signed = new Set(SEED_PATHWAYS.map((p) => p.key));
    for (const key of ["pregnancy_danger_signs", "hypertension_complication", "diabetes_complication"]) {
      expect(signed.has(key)).toBe(false);
      const floor = evaluateBundledRedFlags(cap({ presentingComplaintKey: key, associatedSymptoms: ["seizure", "chest_pain"] }));
      expect(floor.fired.some((f) => f.key.startsWith(`${key}.`))).toBe(false);
    }
    expect(S59D_PATHWAY_KEYS).toEqual(["fever", "pregnancy_danger_signs", "hypertension_complication", "diabetes_complication"]);
    // no key collides with a paediatric draft pathway
    for (const k of S59D_PATHWAY_KEYS) expect(PAEDIATRIC_DRAFT_PATHWAYS.some((p) => p.key === k)).toBe(false);
  });
});

/** Per-pathway vectors authored from the sources named in docs/research/S59d-pathway-coverage.md. */
describe("S59d draft pathways: danger-sign vectors", () => {
  const vectors: Array<[string, string, Partial<SymptomCapture>, TriageCategory]> = [
    // fever (WHO severe malaria features; IMCI-style danger signs; typhoid complications)
    ["fever", "prostration", { associatedSymptoms: ["prostration"] }, "emergency"],
    ["fever", "abnormal bleeding", { associatedSymptoms: ["abnormal_bleeding"] }, "emergency"],
    ["fever", "dark urine", { associatedSymptoms: ["dark_urine"] }, "emergency"],
    ["fever", "board-like belly", { associatedSymptoms: ["rigid_abdomen"] }, "emergency"],
    ["fever", "blood in stool", { associatedSymptoms: ["blood_in_stool"] }, "emergency"],
    ["fever", "confusion", { associatedSymptoms: ["confusion"] }, "emergency"],
    ["fever", "seizure", { associatedSymptoms: ["seizure"] }, "emergency"],
    ["fever", "40 C", { measurements: { temperature_c: 40 } }, "emergency"],
    ["fever", "jaundice", { associatedSymptoms: ["jaundice"] }, "urgent"],
    ["fever", "severe pallor", { associatedSymptoms: ["severe_pallor"] }, "urgent"],
    ["fever", "vomiting that will not stop", { associatedSymptoms: ["persistent_vomiting"] }, "urgent"],
    ["fever", "any breathlessness", { associatedSymptoms: ["breathlessness"], severity: 2 }, "urgent"],
    ["fever", "sickle cell", { relevantHistory: ["sickle_cell_disease"] }, "urgent"],
    ["fever", "pregnant, mild", { relevantHistory: ["pregnant"], severity: 1 }, "urgent"],
    // pregnancy (WHO antenatal danger signs; CDC/ACOG urgent maternal warning signs)
    ["pregnancy_danger_signs", "seizure", { associatedSymptoms: ["seizure"] }, "emergency"],
    ["pregnancy_danger_signs", "heavy bleeding", { associatedSymptoms: ["heavy_vaginal_bleeding"] }, "emergency"],
    ["pregnancy_danger_signs", "headache with vision change", { associatedSymptoms: ["headache", "visual_disturbance"] }, "emergency"],
    ["pregnancy_danger_signs", "loss of sight", { associatedSymptoms: ["vision_loss"] }, "emergency"],
    ["pregnancy_danger_signs", "severe belly pain", { associatedSymptoms: ["severe_abdominal_pain"] }, "emergency"],
    ["pregnancy_danger_signs", "fever and too weak", { associatedSymptoms: ["fever", "prostration"] }, "emergency"],
    ["pregnancy_danger_signs", "difficulty breathing", { associatedSymptoms: ["breathlessness"] }, "emergency"],
    ["pregnancy_danger_signs", "chest pain", { associatedSymptoms: ["chest_pain"], severity: 1 }, "emergency"],
    ["pregnancy_danger_signs", "any bleeding", { associatedSymptoms: ["vaginal_bleeding"] }, "urgent"],
    ["pregnancy_danger_signs", "less movement", { associatedSymptoms: ["reduced_fetal_movement"] }, "urgent"],
    ["pregnancy_danger_signs", "headache alone", { associatedSymptoms: ["headache"] }, "urgent"],
    ["pregnancy_danger_signs", "fever alone", { associatedSymptoms: ["fever"] }, "urgent"],
    ["pregnancy_danger_signs", "leaking fluid", { associatedSymptoms: ["leaking_fluid"] }, "urgent"],
    ["pregnancy_danger_signs", "swelling of face or hands", { associatedSymptoms: ["face_or_hand_swelling"] }, "urgent"],
    // hypertension complications (ESC/ESH, ACC/AHA; FAST/BE-FAST)
    ["hypertension_complication", "chest pain", { associatedSymptoms: ["chest_pain"], severity: 1 }, "emergency"],
    ["hypertension_complication", "weakness or numbness", { associatedSymptoms: ["weakness_or_numbness"] }, "emergency"],
    ["hypertension_complication", "drooping face", { associatedSymptoms: ["facial_droop"] }, "emergency"],
    ["hypertension_complication", "trouble speaking", { associatedSymptoms: ["speech_difficulty"] }, "emergency"],
    ["hypertension_complication", "180 with severe headache", { associatedSymptoms: ["severe_headache"], measurements: { systolic: 180 } }, "emergency"],
    ["hypertension_complication", "120 bottom with blurred sight", { associatedSymptoms: ["visual_disturbance"], measurements: { diastolic: 120 } }, "emergency"],
    ["hypertension_complication", "breathless lying flat", { associatedSymptoms: ["breathless_lying_flat"] }, "emergency"],
    ["hypertension_complication", "pregnant with severe headache", { relevantHistory: ["pregnant"], associatedSymptoms: ["severe_headache"] }, "emergency"],
    ["hypertension_complication", "180 alone", { measurements: { systolic: 180 } }, "urgent"],
    ["hypertension_complication", "severe headache alone", { associatedSymptoms: ["severe_headache"] }, "urgent"],
    ["hypertension_complication", "breathlessness", { associatedSymptoms: ["breathlessness"] }, "urgent"],
    // diabetes complications (ADA levels and hyperglycaemic crises consensus; IWGDF/IDSA foot guidance)
    ["diabetes_complication", "confusion", { associatedSymptoms: ["confusion"] }, "emergency"],
    ["diabetes_complication", "cannot swallow", { associatedSymptoms: ["cannot_swallow"] }, "emergency"],
    ["diabetes_complication", "unresponsive", { associatedSymptoms: ["unresponsive"] }, "emergency"],
    ["diabetes_complication", "deep fast breathing", { associatedSymptoms: ["deep_fast_breathing"] }, "emergency"],
    ["diabetes_complication", "fruity breath", { associatedSymptoms: ["fruity_breath"] }, "emergency"],
    ["diabetes_complication", "vomiting with high sugar", { associatedSymptoms: ["persistent_vomiting"], measurements: { glucose_mmol_l: 15 } }, "emergency"],
    ["diabetes_complication", "vomiting with ketones", { associatedSymptoms: ["persistent_vomiting", "ketones_present"] }, "emergency"],
    ["diabetes_complication", "sugar 33.3", { measurements: { glucose_mmol_l: 33.3 } }, "emergency"],
    ["diabetes_complication", "black foot", { associatedSymptoms: ["foot_black_or_dead_skin"] }, "emergency"],
    ["diabetes_complication", "foot sore with fever", { associatedSymptoms: ["foot_ulcer_or_blister", "fever"] }, "emergency"],
    ["diabetes_complication", "hot swollen foot with fever", { associatedSymptoms: ["foot_red_hot_swollen", "fever"] }, "emergency"],
    ["diabetes_complication", "low sugar 3.0", { measurements: { glucose_mmol_l: 3 } }, "urgent"],
    ["diabetes_complication", "low sugar signs", { associatedSymptoms: ["hypo_warning_signs"] }, "urgent"],
    ["diabetes_complication", "ketones", { associatedSymptoms: ["ketones_present"] }, "urgent"],
    ["diabetes_complication", "new foot sore", { associatedSymptoms: ["foot_ulcer_or_blister"] }, "urgent"],
    ["diabetes_complication", "dose mistake", { triggers: ["insulin_or_tablet_dose_mistake"] }, "urgent"],
  ];

  it.each(vectors)("%s: %s reaches at least the expected category", (key, _name, partial, expected) => {
    // A red flag is final and is not argued down by any answer: try every answer polarity.
    const answerSets: AnswerMap[] = [{}, { higher_check: true, missed_medicine_check: true, thirst_check: false, foot_check: false, low_check: false, recent_check: false, movement_check: true }];
    for (const answers of answerSets) {
      expect(category(key, partial, answers)).toBe(expected);
    }
  });

  it("every pathway has at least one emergency and one urgent red flag", () => {
    for (const p of S59D_DRAFT_PATHWAYS) {
      expect(p.redFlagScreen.some((r) => r.category === "emergency")).toBe(true);
      expect(p.redFlagScreen.some((r) => r.category === "urgent")).toBe(true);
    }
  });

  it("chest pain with sweating is still an emergency, in the signed pathway, in the S59b no-floor draft, and in every S59d pathway that carries chest pain", () => {
    const signed = SEED_PATHWAYS.find((p) => p.key === "chest_pain")!;
    expect(runTriage(signed, cap({ presentingComplaintKey: "chest_pain", severity: 6, associatedSymptoms: ["sweating"] }), {}).category).toBe("emergency");
    // S59b draft: the cardiac pattern with its severity floor removed, applied at the lowest severity
    const noFloor: PresentingComplaintProtocol = {
      ...signed,
      redFlagScreen: signed.redFlagScreen.map((f) => (f.key === "chest_pain.cardiac_pattern" ? { ...f, rule: { ...f.rule, minSeverity: undefined } } : f)),
    };
    expect(runTriage(noFloor, cap({ presentingComplaintKey: "chest_pain", severity: 1, associatedSymptoms: ["sweating"] }), {}).category).toBe("emergency");
    for (const key of ["pregnancy_danger_signs", "hypertension_complication"]) {
      expect(category(key, { severity: 1, associatedSymptoms: ["chest_pain", "sweating"] })).toBe("emergency");
    }
  });
});

describe("S59d draft pathways: more input never lowers urgency (property)", () => {
  function rng(seed: number): () => number {
    let s = seed >>> 0;
    return () => {
      s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
      return s / 4294967296;
    };
  }
  const measurementKeys = ["temperature_c", "systolic", "diastolic", "glucose_mmol_l", "spo2_pct"];
  const measurementValue = (r: () => number, k: string): number => (k === "glucose_mmol_l" ? Math.round(r() * 400) / 10 : k === "temperature_c" ? 35 + Math.round(r() * 70) / 10 : Math.round(r() * 220));

  /** Counts the pairs (a, b) where b knows everything a knows and the result got LESS urgent. */
  function violations(all: readonly PresentingComplaintProtocol[], perPathway: number, seed: number): { checked: number; bad: string[] } {
    const r = rng(seed);
    let checked = 0;
    const bad: string[] = [];
    for (const p of all) {
      const vocab = { sym: p.knownAssociatedSymptoms, trig: p.knownTriggers, hist: p.knownHistory };
      const questions = Object.values(p.nodes).filter((n) => n.type === "question");
      for (let i = 0; i < perPathway; i++) {
        const pickSome = (xs: string[]): string[] => xs.filter(() => r() < 0.3);
        const a: SymptomCapture = cap({
          presentingComplaintKey: p.key,
          onset: r() < 0.5 ? "gradual" : "unknown",
          severity: 1 + Math.floor(r() * 10),
          associatedSymptoms: pickSome(vocab.sym),
          triggers: pickSome(vocab.trig),
          relevantHistory: pickSome(vocab.hist),
          measurements: Object.fromEntries(measurementKeys.filter(() => r() < 0.3).map((k) => [k, measurementValue(r, k)])),
        });
        // b knows everything a knows, and more
        const extraMeasurements = Object.fromEntries(measurementKeys.filter((k) => !(k in a.measurements) && r() < 0.4).map((k) => [k, measurementValue(r, k)]));
        const b: SymptomCapture = {
          ...a,
          onset: a.onset === "gradual" && r() < 0.5 ? "sudden" : a.onset === "unknown" && r() < 0.5 ? "gradual" : a.onset,
          severity: Math.min(10, a.severity + Math.floor(r() * 4)),
          associatedSymptoms: [...new Set([...a.associatedSymptoms, ...pickSome(vocab.sym)])],
          triggers: [...new Set([...a.triggers, ...pickSome(vocab.trig)])],
          relevantHistory: [...new Set([...a.relevantHistory, ...pickSome(vocab.hist)])],
          measurements: { ...a.measurements, ...extraMeasurements },
        };
        const answers: AnswerMap = {};
        for (const q of questions) {
          if (q.type !== "question") continue;
          answers[q.key] = q.kind === "boolean" ? r() < 0.5 : (q.options[Math.floor(r() * q.options.length)]?.value ?? "");
        }
        const ca = runTriage(p, a, answers).category;
        const cb = runTriage(p, b, answers).category;
        checked++;
        if (!categoryAtLeast(cb, ca)) bad.push(`${p.key}: ${ca} -> ${cb}`);
      }
    }
    return { checked, bad };
  }

  it("holds over random captures and answers for every S59d pathway and the signed and paediatric ones", () => {
    const all: readonly PresentingComplaintProtocol[] = [...S59D_DRAFT_PATHWAYS, ...SEED_PATHWAYS, ...PAEDIATRIC_DRAFT_PATHWAYS];
    const out = violations(all, 400, 59);
    expect(out.checked).toBe(all.length * 400);
    expect(out.bad).toEqual([]);
  });

  it("SABOTAGE: the property check really can fail (a pathway where a symptom short-circuits the walk to a LOWER category is caught)", () => {
    const base = path("diabetes_complication");
    const sabotaged: PresentingComplaintProtocol = {
      ...base,
      key: "sabotaged",
      knownAssociatedSymptoms: ["hypo_warning_signs"],
      knownTriggers: [],
      knownHistory: [],
      // a "reassuring" red flag that, when it fires, skips a walk that would have said urgent
      redFlagScreen: [{ key: "sabotaged.reassure", label: "x", category: "self_management", rule: { anyAssociatedSymptom: ["hypo_warning_signs"] } }],
      nodes: { q: { type: "question", kind: "boolean", key: "q", prompt: "q", onYes: "o", onNo: "o" }, o: { type: "outcome", key: "o", category: "urgent", safetyNetMessageKey: "x", clinicianReviewRequired: true, rationale: "x" } },
      startNodeKey: "q",
    };
    expect(violations([sabotaged], 200, 7).bad.length).toBeGreaterThan(0);
  });

  it("the prevalence layer cannot lower any result either (every category, every entry forced into force)", () => {
    const entries = ["fever_after_travel"].map((id) => ({
      id,
      label: "x",
      provenance: { source: "t", note: "t" },
      status: "signed_off" as const,
      clinical_sign_off: { by: "t", at: "2026-10-22" },
      applies_when: { complaint_keys: ["fever"], any_trigger: ["recent_travel"] },
      minimum_category: "urgent" as const,
    }));
    for (const c of TRIAGE_CATEGORIES) {
      const out = applyRiskTightening(c, { capture: cap({ presentingComplaintKey: "fever", triggers: ["recent_travel"] }), month: 5, state: "Lagos" }, { entries });
      expect(categoryAtLeast(out.category, c)).toBe(true);
      // the new trigger key really is understood: a traveller is raised to the minimum, a non-traveller is left alone
      expect(out.category).toBe(categoryAtLeast(c, "urgent") ? c : "urgent");
      const home = applyRiskTightening(c, { capture: cap({ presentingComplaintKey: "fever" }), month: 5, state: "Lagos" }, { entries });
      expect(home.category).toBe(c);
    }
  });
});

describe("S59d draft pathways: a draft is never live", () => {
  const draftConfig = { version: 99, pathways: [...S59D_DRAFT_PATHWAYS] };
  const row = (over: Partial<StoredTriageProtocolRow> = {}): StoredTriageProtocolRow => ({ version: 99, config: draftConfig, is_active: false, approved_at: null, approved_by: null, ...over });

  it("only a row that is active AND signed is live", () => {
    expect(isLiveProtocolRow(row())).toBe(false); // the shipped shape: inactive, unsigned
    expect(isLiveProtocolRow(row({ is_active: true }))).toBe(false); // active but never signed
    expect(isLiveProtocolRow(row({ approved_at: "2026-10-22T10:00:00Z", approved_by: "staff-1" }))).toBe(false); // signed but not active
    expect(isLiveProtocolRow(row({ is_active: true, approved_at: "2026-10-22T10:00:00Z" }))).toBe(false); // half signed
    expect(isLiveProtocolRow(row({ is_active: true, approved_by: "staff-1" }))).toBe(false);
    expect(isLiveProtocolRow(row({ is_active: null }))).toBe(false);
    expect(isLiveProtocolRow(null)).toBe(false);
    expect(isLiveProtocolRow(row({ is_active: true, approved_at: "2026-10-22T10:00:00Z", approved_by: "staff-1" }))).toBe(true);
  });

  it("selectLivePathway and livePathways give nothing for a draft, and a pathway when the row is signed and active", () => {
    for (const key of S59D_PATHWAY_KEYS) {
      expect(selectLivePathway(row(), key)).toBeNull();
      expect(selectLivePathway(row({ is_active: true }), key)).toBeNull();
    }
    expect(livePathways(row())).toEqual([]);
    const live = row({ is_active: true, approved_at: "2026-10-22T10:00:00Z", approved_by: "staff-1" });
    expect(selectLivePathway(live, "diabetes_complication")?.protocolVersion).toBe(99);
    // a RE-ATTESTED row (config copied unchanged from an older version, inner version stale) is served, stamped with the row's version
    const reattested = selectLivePathway({ ...live, version: 100 }, "diabetes_complication");
    expect(reattested?.protocolVersion).toBe(100);
    expect(liveProtocolConfig({ ...live, version: 100 })?.config.version).toBe(100);
    // a malformed config is refused
    expect(selectLivePathway({ ...live, config: { version: 99, pathways: [] } }, "diabetes_complication")).toBeNull();
  });

  it("an engine built for live mode from a draft row has no pathway, and the safe wrapper escalates instead of answering", async () => {
    const safe = createSafeEngine(createInHouseEngine({ pathways: livePathways(row()) }), CONTRACT_DEFAULT_CONFIG);
    for (const key of S59D_PATHWAY_KEYS) {
      const step = await safe.start({ capture: cap({ presentingComplaintKey: key, severity: 2 }), context: EMPTY_CONTEXT });
      expect(step.kind).toBe("complete");
      if (step.kind !== "complete") return;
      expect(step.result.degraded).toBe(true);
      expect(step.result.degradedReason).toBe("protocol_unavailable");
      expect(categoryAtLeast(step.result.category, "urgent")).toBe(true);
      expect(step.result.clinicianReviewRequired).toBe(true);
    }
  });

  it("the migration inserts the S59d version inactive and unsigned, and never calls the sign function", () => {
    const sql = migration("_s59d_draft_pathways_protocol.sql");
    expect(sql).toMatch(/values \(v_version, v_config,[\s\S]*?false\);/);
    const noComments = sql.replace(/--[^\n]*/g, "");
    expect(noComments).not.toMatch(/sign_triage_protocols\s*\(/);
    expect(noComments).not.toMatch(/approved_by\s*=/);
    expect(noComments).not.toMatch(/is_active\s*=\s*true/i);
  });
});

describe("S59d draft pathways: patient wording and the migration copy", () => {
  it("the vocabulary is the union of every symptom, trigger and history key", () => {
    expect(S59D_DRAFT_VOCABULARY).toContain("prostration");
    expect(S59D_DRAFT_VOCABULARY).toContain("ketones_present");
    expect(S59D_DRAFT_VOCABULARY).toContain("recent_travel");
    expect(new Set(S59D_DRAFT_VOCABULARY).size).toBe(S59D_DRAFT_VOCABULARY.length);
  });

  it("match the copy in the migration byte for byte (a drift fails here)", () => {
    const sql = migration("_s59d_draft_pathways_protocol.sql");
    const m = /s59d-draft-begin[\s\S]*?\$json\$([\s\S]*?)\$json\$/.exec(sql);
    if (!m?.[1]) throw new Error("S59d draft JSON not found in the migration");
    expect(JSON.parse(m[1])).toEqual(JSON.parse(JSON.stringify(S59D_DRAFT_PATHWAYS)));
  });
});

describe("S59d coverage matrix document", () => {
  const doc = readFileSync(join(MIGRATIONS, "..", "..", "docs", "research", "S59d-pathway-coverage.md"), "utf8");
  it("names every pathway, every source and every CMO question, and states the true rule counts", async () => {
    const { S59D_REVIEW_NOTES } = await import("./s59d-review-notes");
    expect(Object.keys(S59D_REVIEW_NOTES).sort()).toEqual([...S59D_PATHWAY_KEYS].sort());
    for (const p of S59D_DRAFT_PATHWAYS) {
      expect(doc).toContain(`\`${p.key}\``);
      const e = p.redFlagScreen.filter((r) => r.category === "emergency").length;
      const u = p.redFlagScreen.filter((r) => r.category === "urgent").length;
      expect(doc).toContain(`| ${e} / ${u} |`);
      const notes = S59D_REVIEW_NOTES[p.key]!;
      expect(notes.sources.length).toBeGreaterThan(0);
      expect(notes.unverified.length).toBeGreaterThan(0);
      expect(notes.cmoQuestions.length).toBeGreaterThan(0);
      const ids = notes.cmoQuestions.map((q) => q.id);
      expect(doc).toContain(`${ids[0]} to ${ids[ids.length - 1]}`);
      for (const s of notes.sources) if (s.read === "page_read") expect(s.url).toBeTruthy();
    }
  });
});
