/**
 * Fail toward escalation (spec 12.8; INV-01, INV-06). The acceptance test of module 12: chest pain with sweating returns
 * emergency even if the engine fails. Each case below is also run with the engine disabled, because a floor that only works
 * when the engine works is not a floor (the "sabotage" half of the proof).
 */
import { describe, it, expect } from "@jest/globals";
import { runTriage } from "../engine/index";
import { SEED_PATHWAYS } from "../protocols/index";
import { TRIAGE_CATEGORIES, categoryAtLeast, type PresentingComplaintProtocol, type SymptomCapture, type TriageCategory } from "../types/index";
import { runTriageFailSafe, type DegradedModeConfig, type EngineFn } from "./safe-triage";

const DEGRADED: DegradedModeConfig = { ignore_severity_floors: true, unclassifiable_category: "urgent", engine_timeout_ms: 50 };

const pathway = (key: string): PresentingComplaintProtocol => {
  const p = SEED_PATHWAYS.find((x) => x.key === key);
  if (!p) throw new Error(`no seed pathway ${key}`);
  return p;
};
const capture = (partial: Partial<SymptomCapture> & Pick<SymptomCapture, "presentingComplaintKey">): SymptomCapture => ({
  onset: "gradual",
  severity: 3,
  associatedSymptoms: [],
  triggers: [],
  relevantHistory: [],
  measurements: {},
  ...partial,
});

const throwingEngine: EngineFn = () => {
  throw new Error("engine exploded");
};
const rejectingEngine: EngineFn = () => Promise.reject(new Error("engine unavailable"));
const hangingEngine: EngineFn = () => new Promise(() => undefined);
const garbageEngine = (() => ({ category: "all_clear" })) as unknown as EngineFn;
const BROKEN_ENGINES: ReadonlyArray<[string, EngineFn]> = [
  ["throws", throwingEngine],
  ["rejects", rejectingEngine],
  ["times out", hangingEngine],
  ["returns a category that does not exist", garbageEngine],
];

describe("chest pain with sweating returns emergency even if the engine fails (module 12 acceptance test)", () => {
  const cp = capture({ presentingComplaintKey: "chest_pain", severity: 7, associatedSymptoms: ["sweating"] });

  it("works with a healthy engine", async () => {
    const r = await runTriageFailSafe({ pathway: pathway("chest_pain"), capture: cp, answers: {}, degraded: DEGRADED });
    expect(r.category).toBe("emergency");
    expect(r.degraded).toBe(false);
  });

  for (const [name, engine] of BROKEN_ENGINES) {
    it(`still returns emergency when the engine ${name}`, async () => {
      const r = await runTriageFailSafe({ pathway: pathway("chest_pain"), capture: cp, answers: {}, degraded: DEGRADED, engine });
      expect(r.category).toBe("emergency");
      expect(r.degraded).toBe(true);
      expect(r.clinicianReviewRequired).toBe(true);
      expect(r.safetyNetMessageKey).toBe("redflag.chest_pain.cardiac_pattern");
    });
  }

  it("still returns emergency when the protocol itself could not be loaded", async () => {
    const r = await runTriageFailSafe({ pathway: null, capture: cp, answers: {}, degraded: DEGRADED });
    expect(r.category).toBe("emergency");
    expect(r.degradedReason).toBe("protocol_unavailable");
  });

  it("degraded mode drops the severity floor: chest pain with sweating at severity 3 is emergency when the engine is down", async () => {
    const mild = capture({ presentingComplaintKey: "chest_pain", severity: 3, associatedSymptoms: ["sweating"] });
    const r = await runTriageFailSafe({ pathway: pathway("chest_pain"), capture: mild, answers: {}, degraded: DEGRADED, engine: throwingEngine });
    expect(r.category).toBe("emergency");
  });

  it("with the severity floor kept (config says so) a mild reading falls to the unclassifiable category, never below urgent", async () => {
    const mild = capture({ presentingComplaintKey: "chest_pain", severity: 3, associatedSymptoms: ["sweating"] });
    const r = await runTriageFailSafe({
      pathway: pathway("chest_pain"),
      capture: mild,
      answers: {},
      degraded: { ...DEGRADED, ignore_severity_floors: false },
      engine: throwingEngine,
    });
    expect(r.category).toBe("urgent");
    expect(r.clinicianReviewRequired).toBe(true);
  });
});

describe("a failed engine is never reassurance", () => {
  it("no red flag and a broken engine is urgent with human review, for every bundled pathway", async () => {
    for (const p of SEED_PATHWAYS) {
      for (const [, engine] of BROKEN_ENGINES) {
        const r = await runTriageFailSafe({ pathway: p, capture: capture({ presentingComplaintKey: p.key }), answers: {}, degraded: DEGRADED, engine });
        expect(categoryAtLeast(r.category, "urgent")).toBe(true);
        expect(r.clinicianReviewRequired).toBe(true);
        expect(r.safetyNetMessageKey).toBe("degraded.engine_unavailable");
      }
    }
  });

  it("an unknown complaint with a broken engine tries every bundled rule and still escalates", async () => {
    const r = await runTriageFailSafe({
      pathway: null,
      capture: capture({ presentingComplaintKey: "something_new", associatedSymptoms: ["fainting"] }),
      answers: {},
      degraded: DEGRADED,
    });
    expect(r.category).toBe("emergency");
  });

  it("never throws, whatever the engine does", async () => {
    await expect(
      runTriageFailSafe({ pathway: pathway("headache"), capture: capture({ presentingComplaintKey: "headache" }), answers: {}, degraded: DEGRADED, engine: throwingEngine }),
    ).resolves.toBeDefined();
  });
});

describe("the floor can only raise the engine's answer", () => {
  it("a lenient engine cannot argue down a fired red flag", async () => {
    const lenient: EngineFn = (p, c) => ({
      category: "self_management",
      clinicianReviewRequired: false,
      safetyNetMessageKey: "chest_pain.self_msk",
      rationale: "lenient",
      redFlagScreen: { hasFlag: false, fired: [], brokenRules: [], topCategory: null },
      questionsAsked: [],
      ...(p && c ? {} : {}),
    });
    const r = await runTriageFailSafe({
      pathway: pathway("chest_pain"),
      capture: capture({ presentingComplaintKey: "chest_pain", severity: 8, associatedSymptoms: ["breathlessness"] }),
      answers: {},
      degraded: DEGRADED,
      engine: lenient,
    });
    expect(r.category).toBe("emergency");
    expect(r.floorRaised).toBe(true);
    expect(r.degraded).toBe(false);
  });

  it("monotonic: for every category an engine can answer, the result is never less urgent than the engine's own answer", async () => {
    for (const cat of TRIAGE_CATEGORIES) {
      const engine: EngineFn = () => ({
        category: cat as TriageCategory,
        clinicianReviewRequired: false,
        safetyNetMessageKey: "x",
        rationale: "x",
        redFlagScreen: { hasFlag: false, fired: [], brokenRules: [], topCategory: null },
        questionsAsked: [],
      });
      for (const sx of [[], ["sweating"], ["fainting"]]) {
        const r = await runTriageFailSafe({
          pathway: pathway("chest_pain"),
          capture: capture({ presentingComplaintKey: "chest_pain", severity: 7, associatedSymptoms: sx }),
          answers: {},
          degraded: DEGRADED,
          engine,
        });
        expect(categoryAtLeast(r.category, cat)).toBe(true);
      }
    }
  });

  it("the happy path is unchanged: the in-house engine answer passes through when the floor adds nothing", async () => {
    const c = capture({ presentingComplaintKey: "headache", severity: 2 });
    const direct = runTriage(pathway("headache"), c, {}, []);
    const safe = await runTriageFailSafe({ pathway: pathway("headache"), capture: c, answers: {}, degraded: DEGRADED });
    expect(safe.category).toBe(direct.category);
    expect(safe.degraded).toBe(false);
    expect(safe.floorRaised).toBe(false);
  });

  it("a hung engine is cut off at the configured timeout, not waited on", async () => {
    const t0 = Date.now();
    const r = await runTriageFailSafe({ pathway: pathway("headache"), capture: capture({ presentingComplaintKey: "headache" }), answers: {}, degraded: DEGRADED, engine: hangingEngine });
    expect(r.degradedReason).toBe("engine_timeout");
    expect(Date.now() - t0).toBeLessThan(1000);
  });
});

describe("a pending question is only ended by an emergency floor", () => {
  const pending = (): ReturnType<EngineFn> => ({
    category: "self_management",
    clinicianReviewRequired: false,
    safetyNetMessageKey: "",
    rationale: "",
    redFlagScreen: { hasFlag: false, fired: [], brokenRules: [], topCategory: null },
    questionsAsked: [],
    nextQuestion: { type: "question", key: "q1", kind: "boolean", prompt: "Anything else?", onYes: "a", onNo: "b" },
  });

  it("an emergency floor ends the walk with the emergency (the patient is not asked more questions first)", async () => {
    const r = await runTriageFailSafe({
      pathway: pathway("chest_pain"),
      capture: capture({ presentingComplaintKey: "chest_pain", severity: 7, associatedSymptoms: ["sweating"] }),
      answers: {},
      degraded: DEGRADED,
      engine: pending,
    });
    expect(r.category).toBe("emergency");
    expect(r.nextQuestion).toBeUndefined();
  });

  it("an urgent floor lets the walk continue, so a later answer can still raise it to emergency", async () => {
    const r = await runTriageFailSafe({
      pathway: pathway("headache"),
      capture: capture({ presentingComplaintKey: "headache", severity: 6, relevantHistory: ["pregnant"] }),
      answers: {},
      degraded: DEGRADED,
      engine: pending,
    });
    expect(r.nextQuestion).toBeDefined();
    expect(r.floorRaised).toBe(false);
  });

  it("...and the urgent floor still raises the FINAL result when the engine then answers lower", async () => {
    const lower: EngineFn = () => ({
      category: "self_management",
      clinicianReviewRequired: false,
      safetyNetMessageKey: "headache.self_mild",
      rationale: "mild",
      redFlagScreen: { hasFlag: false, fired: [], brokenRules: [], topCategory: null },
      questionsAsked: [],
    });
    const r = await runTriageFailSafe({
      pathway: pathway("headache"),
      capture: capture({ presentingComplaintKey: "headache", severity: 6, relevantHistory: ["pregnant"] }),
      answers: {},
      degraded: DEGRADED,
      engine: lower,
    });
    expect(r.category).toBe("urgent");
    expect(r.floorRaised).toBe(true);
  });
});


describe("review fixes (PR #1003)", () => {
  const screen = { hasFlag: false, fired: [], brokenRules: [], topCategory: null };
  const asked = [{ key: "q_one", answer: true }] as unknown as ReturnType<EngineFn> extends infer R ? (R extends { questionsAsked: infer Q } ? Q : never) : never;

  it("when the floor overrides the engine, the questions the engine really asked are kept, not wiped", async () => {
    const lenient: EngineFn = () => ({
      category: "self_management",
      clinicianReviewRequired: false,
      safetyNetMessageKey: "chest_pain.self_msk",
      rationale: "lenient",
      redFlagScreen: screen,
      questionsAsked: asked,
    });
    const r = await runTriageFailSafe({
      pathway: pathway("chest_pain"),
      capture: capture({ presentingComplaintKey: "chest_pain", severity: 8, associatedSymptoms: ["breathlessness"] }),
      answers: {},
      degraded: DEGRADED,
      engine: lenient,
    });
    expect(r.floorRaised).toBe(true);
    expect(r.category).toBe("emergency");
    expect(r.questionsAsked).toEqual(asked);
    expect((r.questionsAsked as unknown[]).length).toBe(1);
  });

  it("the engine is given an AbortSignal, which is not aborted on a healthy run", async () => {
    let seen: AbortSignal | undefined;
    const spy: EngineFn = (p, c, a, q, signal) => {
      seen = signal;
      return runTriage(p, c, a, q);
    };
    const r = await runTriageFailSafe({ pathway: pathway("headache"), capture: capture({ presentingComplaintKey: "headache" }), answers: {}, degraded: DEGRADED, engine: spy });
    expect(r.degraded).toBe(false);
    expect(seen).toBeDefined();
    expect(seen?.aborted).toBe(false);
  });

  it("a timed-out async engine is told to stop: its signal is aborted, so it can cancel its own work", async () => {
    let seen: AbortSignal | undefined;
    let cancelled = false;
    const cancellable: EngineFn = (_p, _c, _a, _q, signal) =>
      new Promise((_resolve, reject) => {
        seen = signal;
        signal?.addEventListener("abort", () => {
          cancelled = true;
          reject(new Error("aborted"));
        });
      });
    const r = await runTriageFailSafe({ pathway: pathway("headache"), capture: capture({ presentingComplaintKey: "headache" }), answers: {}, degraded: DEGRADED, engine: cancellable });
    expect(r.degradedReason).toBe("engine_timeout");
    expect(seen?.aborted).toBe(true);
    expect(cancelled).toBe(true);
  });

  it("an engine written with the old four parameters still works (backward compatible)", async () => {
    const old = ((p, c, a, q) => runTriage(p, c, a, q)) as (p: PresentingComplaintProtocol, c: SymptomCapture, a: never, q: never[]) => ReturnType<typeof runTriage>;
    const r = await runTriageFailSafe({ pathway: pathway("headache"), capture: capture({ presentingComplaintKey: "headache" }), answers: {}, degraded: DEGRADED, engine: old as unknown as EngineFn });
    expect(r.degraded).toBe(false);
  });
});
