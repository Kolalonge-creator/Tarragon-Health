import { describe, expect, it } from "@jest/globals";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { en, pcm } from "@tarragon/i18n";
import * as pkg from "./index";
import { ProtocolDefinitionError, proposalToChangeArgs, proposeTitration, validateProtocolDefinition } from "./titration";
import { TITRATION_LABEL_KEYS, TITRATION_STOP_KEYS } from "./titration-messages";
import { TITRATION_PLACEHOLDER } from "./titration-fixture";
import type { ProtocolDefinition, TitrationInput, TitrationProposal, TitrationResult, TitrationStopCode } from "./titration-types";

const NOW = "2026-10-06T09:00:00Z";
const DAY = 86_400_000;
const ago = (days: number): string => new Date(Date.parse(NOW) - days * DAY).toISOString();
const clone = <T,>(v: T): T => JSON.parse(JSON.stringify(v)) as T;
const deepFreeze = <T,>(v: T): T => {
  if (typeof v === "object" && v !== null) {
    Object.values(v).forEach(deepFreeze);
    Object.freeze(v);
  }
  return v;
};
const med = (over: Partial<TitrationInput["currentMedications"][number]> = {}) => ({
  id: "med-a",
  drugName: "TestDrugA",
  dose: "5 mg",
  frequency: "once daily",
  startedAt: ago(60),
  clinicianIssued: true,
  ...over,
});
const readings = (n: number, sys = 150, dia = 95, startDaysAgo = 1) =>
  Array.from({ length: n }, (_, i) => ({ systolic: sys, diastolic: dia, takenAt: ago(startDaysAgo + i * 0.5), validated: true }));
const base = (over: Partial<TitrationInput> = {}): TitrationInput => ({
  now: NOW,
  isTest: true,
  patient: { ageYears: 52, pregnancy: "no" },
  target: { systolic: 135, diastolic: 85 },
  readings: readings(5),
  currentMedications: [med()],
  adherencePercent: 90,
  openTriage: "none",
  sideEffectsReported: false,
  lastChangeAt: ago(60),
  ...over,
});
const proto = (edit?: (d: ProtocolDefinition) => void): ProtocolDefinition => {
  const d = clone(TITRATION_PLACEHOLDER);
  edit?.(d);
  return d;
};
const codes = (r: TitrationResult): TitrationStopCode[] => (r.kind === "no_proposal" ? r.reasons.map((x) => x.code) : []);
const proposal = (r: TitrationResult): TitrationProposal => {
  if (r.kind !== "proposal") throw new Error(`expected a proposal, got ${JSON.stringify(r)}`);
  return r;
};

describe("placeholder protocol", () => {
  it("is marked draft, placeholder, with fictional drugs, and validates", () => {
    const raw = JSON.parse(readFileSync(join(dirname(fileURLToPath(import.meta.url)), "..", "fixtures", "titration-placeholder.json"), "utf8")) as Record<string, unknown>;
    expect(raw.placeholder).toBe(true);
    expect(raw.status).toBe("draft");
    expect(JSON.stringify(raw)).toMatch(/TestDrugA/);
    expect(validateProtocolDefinition(raw).ok).toBe(true);
  });
  it("a draft protocol is refused for a real patient and works for a test patient", () => {
    const real = proposeTitration(base({ isTest: false }), TITRATION_PLACEHOLDER);
    expect(codes(real)).toEqual(["protocol_not_approved_for_real_patient"]);
    expect(proposeTitration(base({ isTest: true }), TITRATION_PLACEHOLDER).kind).toBe("proposal");
  });
  it("an approved protocol works for a real patient; a retired one never does", () => {
    expect(proposeTitration(base({ isTest: false }), proto((d) => (d.status = "approved"))).kind).toBe("proposal");
    expect(codes(proposeTitration(base({ isTest: true }), proto((d) => (d.status = "retired"))))).toEqual(["protocol_not_approved_for_real_patient"]);
  });
});

describe("validateProtocolDefinition", () => {
  it("accepts the placeholder and returns the definition", () => {
    const v = validateProtocolDefinition(TITRATION_PLACEHOLDER);
    expect(v.ok && v.definition.code).toBe("htn_hearts_ng");
  });
  it.each<[string, unknown, string]>([
    ["not an object", 5, "definition must be an object"],
    ["array", [], "definition must be an object"],
  ])("refuses %s", (_n, def, msg) => expect(validateProtocolDefinition(def)).toEqual({ ok: false, errors: [msg] }));

  const mutate = (edit: (d: Record<string, any>) => void): unknown => { // eslint-disable-line @typescript-eslint/no-explicit-any
    const d = clone(TITRATION_PLACEHOLDER) as unknown as Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
    edit(d);
    return d;
  };
  it.each<[string, (d: Record<string, any>) => void, string]>([ // eslint-disable-line @typescript-eslint/no-explicit-any
    ["no code", (d) => (d.code = " "), "code is required"],
    ["bad version", (d) => (d.version = 0), "version must be"],
    ["fractional version", (d) => (d.version = 1.5), "version must be"],
    ["bad status", (d) => (d.status = "live"), "status must be"],
    ["numeric status", (d) => (d.status = 3), "status must be"],
    ["params missing", (d) => delete d.params, "params must be an object"],
    ["minReadings", (d) => (d.params.minReadings = 0), "minReadings"],
    ["windowDays", (d) => (d.params.windowDays = 0), "windowDays"],
    ["windowDays text", (d) => (d.params.windowDays = "x"), "windowDays"],
    ["adherence low", (d) => (d.params.minAdherencePercent = -1), "minAdherencePercent"],
    ["adherence high", (d) => (d.params.minAdherencePercent = 101), "minAdherencePercent"],
    ["adherence text", (d) => (d.params.minAdherencePercent = "x"), "minAdherencePercent"],
    ["reviewWindowDays", (d) => (d.params.reviewWindowDays = -1), "reviewWindowDays"],
    ["staleAfterDays", (d) => (d.params.staleAfterDays = 0), "staleAfterDays"],
    ["requireValidated", (d) => (d.params.requireValidated = "yes"), "requireValidated"],
    ["validation missing", (d) => delete d.params.validation, "params.validation"],
    ["validation systolic inverted", (d) => (d.params.validation.systolicMin = 999), "params.validation"],
    ["validation diastolic inverted", (d) => (d.params.validation.diastolicMin = 999), "params.validation"],
    ["validation field missing", (d) => delete d.params.validation.diastolicMax, "params.validation"],
    ["steps missing", (d) => delete d.steps, "steps must be"],
    ["steps empty", (d) => (d.steps = []), "steps must be"],
    ["step not an object", (d) => (d.steps[0] = 3), "steps[0] must be an object"],
    ["step id missing", (d) => (d.steps[0].id = ""), "steps[0].id is required"],
    ["step id duplicate", (d) => (d.steps[1].id = d.steps[0].id), "steps[1].id is a duplicate"],
    ["requires not a list", (d) => (d.steps[0].requires = "x"), "requires must be a list"],
    ["requires entry not an object", (d) => (d.steps[1].requires = [1]), "requires entries"],
    ["requires entry no drug", (d) => (d.steps[1].requires = [{ dose: "5 mg" }]), "requires entries"],
    ["requires entry no dose", (d) => (d.steps[1].requires = [{ drugName: "TestDrugA" }]), "requires entries"],
    ["requires entry bad frequency", (d) => (d.steps[1].requires = [{ drugName: "TestDrugA", dose: "5 mg", frequency: 3 }]), "requires entries"],
    ["propose wrong type", (d) => (d.steps[0].propose = "x"), "propose must be an object or null"],
    ["propose missing", (d) => delete d.steps[0].propose, "propose must be an object or null"],
    ["action unknown", (d) => (d.steps[0].propose.action = "stop"), "action must be start or change"],
    ["action not text", (d) => (d.steps[0].propose.action = 1), "action must be start or change"],
    ["change names nothing", (d) => delete d.steps[1].propose.changes, "changes must name"],
    ["change names a stranger", (d) => (d.steps[1].propose.changes = "Other"), "changes must name"],
    ["item missing", (d) => delete d.steps[0].propose.item, "propose.item needs"],
    ["item no drug", (d) => (d.steps[0].propose.item.drugName = ""), "propose.item needs"],
    ["item no dose", (d) => (d.steps[0].propose.item.dose = ""), "propose.item needs"],
    ["item no frequency", (d) => (d.steps[0].propose.item.frequency = ""), "propose.item needs"],
    ["item no quantity", (d) => (d.steps[0].propose.item.quantity = ""), "propose.item needs"],
    ["item no duration", (d) => (d.steps[0].propose.item.durationDays = 0), "propose.item needs"],
  ])("refuses a definition with %s", (_n, edit, needle) => {
    const v = validateProtocolDefinition(mutate(edit));
    expect(v.ok).toBe(false);
    expect(v.ok ? [] : v.errors.join("|")).toContain(needle);
  });

  it("reports several errors together", () => {
    const v = validateProtocolDefinition(mutate((d) => { d.code = ""; d.version = 0; }));
    expect(v.ok ? 0 : v.errors.length).toBe(2);
  });
  it("proposeTitration refuses a malformed definition whole, never half applying it", () => {
    const bad = proto((d) => { d.steps = []; });
    expect(() => proposeTitration(base(), bad)).toThrow(ProtocolDefinitionError);
    try { proposeTitration(base(), bad); } catch (e) { expect((e as ProtocolDefinitionError).errors.join()).toContain("steps"); }
  });
  it("proposeTitration refuses an unreadable now", () => {
    expect(() => proposeTitration(base({ now: "tomorrow-ish" }), TITRATION_PLACEHOLDER)).toThrow(RangeError);
  });
});

describe("stop codes, each on its own", () => {
  it("baseline is a proposal", () => expect(proposeTitration(base(), TITRATION_PLACEHOLDER).kind).toBe("proposal"));

  const cases: [TitrationStopCode, TitrationInput][] = [
    ["pregnancy_or_unknown", base({ patient: { ageYears: 30, pregnancy: "yes" } })],
    ["pregnancy_or_unknown", base({ patient: { ageYears: 30, pregnancy: "unknown" } })],
    ["open_red_triage", base({ openTriage: "red" })],
    ["open_amber_triage", base({ openTriage: "amber" })],
    ["too_few_readings", base({ readings: readings(3) })],
    ["too_few_readings", base({ readings: [] })],
    ["unreliable_readings", base({ readings: [...readings(5), { systolic: 400, diastolic: 95, takenAt: ago(1), validated: true }] })],
    ["unreliable_readings", base({ readings: [...readings(5), { systolic: 150, diastolic: 10, takenAt: ago(1), validated: true }] })],
    ["unreliable_readings", base({ readings: [...readings(5), { systolic: 150, diastolic: 95, takenAt: ago(1), validated: false }] })],
    ["unreliable_readings", base({ readings: [...readings(5), { systolic: 150, diastolic: 95, takenAt: "not a date", validated: true }] })],
    ["unreliable_readings", base({ readings: [...readings(5), { systolic: 150, diastolic: 95, takenAt: ago(-1), validated: true }] })],
    ["low_adherence", base({ adherencePercent: 50 })],
    ["adherence_unknown", base({ adherencePercent: null })],
    ["change_inside_review_window", base({ lastChangeAt: ago(5) })],
    ["change_inside_review_window", base({ lastChangeAt: "garbled" })],
    ["change_inside_review_window", base({ currentMedications: [med({ startedAt: ago(2) })] })],
    ["side_effects_reported", base({ sideEffectsReported: true })],
    ["readings_stale", base({ readings: readings(5, 150, 95, 4.5).map((r, i) => ({ ...r, takenAt: ago(4.5 + (i % 2) * 0.2) })) })],
    ["already_at_target", base({ readings: readings(5, 120, 80) })],
    ["no_matching_step", base({ currentMedications: [med({ drugName: "Unlisted" })] })],
    ["no_matching_step", base({ currentMedications: [med({ clinicianIssued: false })] })],
    ["no_matching_step", base({ currentMedications: [med({ frequency: "twice daily", dose: "10 mg" })] })],
    ["final_step_reached", base({ currentMedications: [med({ dose: "10 mg" }), med({ id: "med-b", drugName: "TestDrugB", dose: "25 mg" })] })],
  ];
  it.each(cases.map((c, i) => [c[0], i, c[1]] as const))("%s (case %#)", (code, _i, input) => {
    const r = proposeTitration(input, TITRATION_PLACEHOLDER);
    expect(r.kind).toBe("no_proposal");
    expect(codes(r)).toEqual([code]);
  });

  it("returns every reason that applies, in a fixed order, never just the first", () => {
    const r = proposeTitration(
      base({ isTest: false, patient: { ageYears: 40, pregnancy: "unknown" }, openTriage: "red", adherencePercent: 10, sideEffectsReported: true, readings: [], lastChangeAt: ago(1) }),
      TITRATION_PLACEHOLDER,
    );
    expect(codes(r)).toEqual([
      "protocol_not_approved_for_real_patient",
      "pregnancy_or_unknown",
      "open_red_triage",
      "too_few_readings",
      "low_adherence",
      "change_inside_review_window",
      "side_effects_reported",
    ]);
  });
  it("gives a plain detail with the reason", () => {
    const r = proposeTitration(base({ readings: readings(2), adherencePercent: 10 }), TITRATION_PLACEHOLDER);
    expect(r.kind === "no_proposal" && r.reasons.map((x) => x.detail)).toEqual(["2 usable readings, 4 needed", "adherence 10 percent"]);
  });
  it("amber and red triage together report both", () => {
    // openTriage is one value; the worst one shown is the one passed in
    expect(codes(proposeTitration(base({ openTriage: "red" }), TITRATION_PLACEHOLDER))).toContain("open_red_triage");
  });
  it("readings outside the window are ignored; a protocol that does not require validation accepts an unmarked reading", () => {
    const old = { systolic: 150, diastolic: 95, takenAt: ago(30), validated: true };
    expect(codes(proposeTitration(base({ readings: [...readings(3), old] }), TITRATION_PLACEHOLDER))).toEqual(["too_few_readings"]);
    const lax = proto((d) => { d.params.requireValidated = false; });
    const unmarked = readings(5).map((r) => ({ ...r, validated: false }));
    expect(proposeTitration(base({ readings: unmarked }), lax).kind).toBe("proposal");
  });
  it("a review window of zero never blocks", () => {
    const none = proto((d) => { d.params.reviewWindowDays = 0; });
    expect(proposeTitration(base({ lastChangeAt: ago(0.1), currentMedications: [med({ startedAt: ago(0.1) })] }), none).kind).toBe("proposal");
  });
});

describe("proposals at each step", () => {
  it("step 0: a patient on no medicine gets a start", () => {
    const p = proposal(proposeTitration(base({ currentMedications: [], lastChangeAt: null }), TITRATION_PLACEHOLDER));
    expect(p.stepId).toBe("step_0_start");
    expect(p.action).toBe("start");
    expect(p.medicationId).toBeUndefined();
    expect(p.item.drugName).toBe("TestDrugA");
    expect(p.item.dose).toBe("5 mg");
  });
  it("step 1: a change names the current medicine's id", () => {
    const p = proposal(proposeTitration(base(), TITRATION_PLACEHOLDER));
    expect(p).toMatchObject({ stepId: "step_1_raise_a", action: "change", medicationId: "med-a" });
    expect(p.item.dose).toBe("10 mg");
    expect(p.rationale).toContain("Placeholder rationale.");
    expect(p.rationale).toContain("Raise TestDrugA");
    expect(p.rationale).toContain("150/95");
  });
  it("step 2: an add-on is a start of a second medicine; matching ignores case and spaces", () => {
    const p = proposal(proposeTitration(base({ currentMedications: [med({ drugName: " testdrugA ", dose: "10MG" })] }), TITRATION_PLACEHOLDER));
    expect(p).toMatchObject({ stepId: "step_2_add_b", action: "start" });
    expect(p.item.drugName).toBe("TestDrugB");
    expect(p.rationale).not.toContain("Placeholder rationale.");
  });
  it("a step with no label still gets a rationale", () => {
    const d = proto((x) => { delete x.steps[0].label; });
    const p = proposal(proposeTitration(base({ currentMedications: [], lastChangeAt: null }), d));
    expect(p.rationale).not.toContain("(");
  });
  it("the most specific matching step wins whatever the table order", () => {
    const both = [med({ dose: "10 mg" }), med({ id: "med-b", drugName: "TestDrugB", dose: "25 mg" })];
    const reversed = proto((d) => { d.steps.reverse(); });
    expect(codes(proposeTitration(base({ currentMedications: both }), TITRATION_PLACEHOLDER))).toEqual(["final_step_reached"]);
    expect(codes(proposeTitration(base({ currentMedications: both }), reversed))).toEqual(["final_step_reached"]);
  });
  it("the proposal comes only from the protocol's own table", () => {
    const p = proposal(proposeTitration(base(), TITRATION_PLACEHOLDER));
    const table = TITRATION_PLACEHOLDER.steps.map((s) => s.propose?.item.drugName + "|" + s.propose?.item.dose);
    expect(table).toContain(`${p.item.drugName}|${p.item.dose}`);
  });
  it("records the exact inputs (INV-16)", () => {
    const input = base();
    const p = proposal(proposeTitration(input, TITRATION_PLACEHOLDER));
    expect(p.inputs).toMatchObject({
      now: NOW, isTest: true, stepId: "step_1_raise_a", readingCount: 5, averageSystolic: 150, averageDiastolic: 95,
      protocol: { code: "htn_hearts_ng", version: 1, status: "draft" }, adherencePercent: 90, openTriage: "none",
    });
    expect(p.inputs.currentMedications).toEqual(input.currentMedications);
    expect(p.inputs.params).toEqual(TITRATION_PLACEHOLDER.params);
  });
  it("no readings at all: no average is invented", () => {
    const r = proposeTitration(base({ readings: [] }), TITRATION_PLACEHOLDER);
    expect(codes(r)).toEqual(["too_few_readings"]);
  });
});

describe("proposalToChangeArgs", () => {
  it("maps a change to the exact propose_care_plan_change arguments", () => {
    const p = proposal(proposeTitration(base(), TITRATION_PLACEHOLDER));
    const args = proposalToChangeArgs(p, "patient-1", "proto-1");
    expect(args).toEqual({
      p_patient: "patient-1",
      p_kind: "medication",
      p_proposal: { action: "change", medication_id: "med-a", item: { drug_name: "TestDrugA", dose: "10 mg", frequency: "once daily", duration_days: 28, quantity: "28 tablets" } },
      p_rationale: p.rationale,
      p_proposed_by: "engine",
      p_protocol_id: "proto-1",
      p_engine_inputs: p.inputs,
    });
  });
  it("maps a start with every optional field", () => {
    const p = proposal(proposeTitration(base({ currentMedications: [], lastChangeAt: null }), TITRATION_PLACEHOLDER));
    const args = proposalToChangeArgs(p, "patient-1", "proto-1");
    expect(args.p_proposal).toEqual({
      action: "start",
      item: { drug_name: "TestDrugA", dose: "5 mg", frequency: "once daily", route: "oral", duration_days: 28, quantity: "28 tablets", repeats_allowed: 0, indication: "Test indication", instructions: "Test instructions" },
    });
    expect("medication_id" in args.p_proposal).toBe(false);
  });
});

describe("purity, determinism and safety case 10 (evaluator level)", () => {
  it("never mutates its input or the protocol, and frozen inputs do not throw", () => {
    const input = base();
    const before = clone(input);
    const pBefore = clone(TITRATION_PLACEHOLDER);
    proposeTitration(input, TITRATION_PLACEHOLDER);
    expect(input).toEqual(before);
    expect(TITRATION_PLACEHOLDER).toEqual(pBefore);
    const frozen = deepFreeze(base());
    const frozenProto = deepFreeze(clone(TITRATION_PLACEHOLDER));
    expect(() => proposeTitration(frozen, frozenProto)).not.toThrow();
    expect(() => proposeTitration(deepFreeze(base({ openTriage: "red" })), frozenProto)).not.toThrow();
  });
  it("the result shares no references with the input", () => {
    const input = base();
    const p = proposal(proposeTitration(input, TITRATION_PLACEHOLDER));
    expect(p.inputs.readings[0]).not.toBe(input.readings[0]);
    expect(p.inputs.currentMedications[0]).not.toBe(input.currentMedications[0]);
    expect(p.item).not.toBe(TITRATION_PLACEHOLDER.steps[1]?.propose?.item);
  });
  it("is deterministic", () => {
    expect(proposeTitration(base(), TITRATION_PLACEHOLDER)).toEqual(proposeTitration(base(), TITRATION_PLACEHOLDER));
    expect(proposeTitration(base({ openTriage: "red" }), TITRATION_PLACEHOLDER)).toEqual(proposeTitration(base({ openTriage: "red" }), TITRATION_PLACEHOLDER));
  });
  it("a result is data only: plain JSON, no functions, and the module exports nothing that writes", () => {
    const r = proposeTitration(base(), TITRATION_PLACEHOLDER);
    expect(JSON.parse(JSON.stringify(r))).toEqual(JSON.parse(JSON.stringify(r)));
    const walk = (v: unknown): void => {
      expect(typeof v).not.toBe("function");
      if (typeof v === "object" && v !== null) Object.values(v).forEach(walk);
    };
    walk(r);
    const titrationExports = Object.keys(pkg).filter((k) => /titration|protocol|proposal/i.test(k)).sort();
    expect(titrationExports).toEqual(["ProtocolDefinitionError", "TITRATION_LABEL_KEYS", "TITRATION_STOP_KEYS", "proposalToChangeArgs", "proposeTitration", "validateProtocolDefinition"]);
  });
  it("the evaluator source imports nothing that could do I/O and calls no clock or random", () => {
    const src = source();
    expect(src).not.toMatch(/^import (?!type)/m);
    expect(src).not.toMatch(/Date\.now|new Date\(\)|Math\.random|fetch\(|require\(|process\./);
  });
});

function source(): string {
  return readFileSync(join(dirname(fileURLToPath(import.meta.url)), "titration.ts"), "utf8");
}

describe("the evaluator holds no drug name, dose or clinical threshold (INV-01)", () => {
  const code = source().replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
  it("contains no drug-name word", () => {
    const words = [
      "amlodipine", "lisinopril", "ramipril", "enalapril", "perindopril", "captopril", "losartan", "telmisartan", "valsartan", "candesartan", "irbesartan",
      "hydrochlorothiazide", "chlorthalidone", "indapamide", "furosemide", "spironolactone", "atenolol", "bisoprolol", "metoprolol", "propranolol",
      "nifedipine", "felodipine", "diltiazem", "verapamil", "methyldopa", "hydralazine", "metformin", "insulin", "glibenclamide", "gliclazide",
    ];
    for (const w of words) expect([w, new RegExp(w, "i").test(code)]).toEqual([w, false]);
  });
  it("contains no numeric literal other than 0, 1, 100 and the milliseconds in a day", () => {
    const literals = [...code.matchAll(/(?<![\w.$])\d[\d_]*(?:\.\d+)?(?![\w])/g)].map((m) => m[0]);
    const allowed = new Set(["0", "1", "100", "86_400_000"]);
    expect(literals.filter((l) => !allowed.has(l))).toEqual([]);
  });
  it("the scan itself can fail: a threshold-like literal is caught", () => {
    const sample = "const x = systolic > 140;";
    const literals = [...sample.matchAll(/(?<![\w.$])\d[\d_]*(?:\.\d+)?(?![\w])/g)].map((m) => m[0]);
    expect(literals).toEqual(["140"]);
  });
});

describe("message keys", () => {
  it("every stop code and label has an English and a Pidgin string", () => {
    const keys = [...Object.values(TITRATION_STOP_KEYS), ...Object.values(TITRATION_LABEL_KEYS)];
    for (const k of keys) {
      expect([k, k in en]).toEqual([k, true]);
      expect([k, k in pcm]).toEqual([k, true]);
    }
  });
  it("covers all fourteen stop codes", () => expect(Object.keys(TITRATION_STOP_KEYS)).toHaveLength(14));
});
