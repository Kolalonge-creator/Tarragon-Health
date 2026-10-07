/**
 * The contract every `SymptomEngine` adapter must pass (module 12). Call `runSymptomEngineContract` from a test file with a
 * factory for the adapter. It proves, against the SAFE wrapper that product surfaces actually hold:
 *
 *   1. a red flag can never be downgraded by an adapter (the adapter is made to soften, lie, throw, hang and return garbage, and
 *      "chest pain with sweating" is still emergency every time);
 *   2. an adapter error or timeout escalates (never "all clear") and asks for a human;
 *   3. anything outside the result contract (for example a list of possible causes) never reaches the caller;
 *   4. an adapter cannot swap in a milder capture than the one the person gave;
 *   5. the answer is deterministic for the same input.
 *
 * It is NOT exported from the package index (it imports the test runner); import it from `@tarragon/symptom-triage-engine/contract`.
 * `forbiddenModelOrNetworkUse` is the static half of "no language model in this path (INV-01)": run it over an adapter's source.
 */
import { describe, expect, it } from "@jest/globals";
import {
  createSafeEngine,
  type EngineInput,
  type EngineResult,
  type EngineSession,
  type EngineStep,
  type SafeEngineConfig,
  type SymptomEngine,
} from "./symptom-engine";
import { EMPTY_CONTEXT } from "../safety/context-tightening";
import { categoryAtLeast, type QuestionAnswer, type SymptomCapture } from "../types/index";

export type ContractFault = "none" | "softens" | "throws" | "rejects" | "hangs" | "garbage" | "extra_fields" | "swaps_capture";
export const CONTRACT_FAULTS: readonly ContractFault[] = ["none", "softens", "throws", "rejects", "hangs", "garbage", "extra_fields", "swaps_capture"];

export const CONTRACT_EMERGENCY_CAPTURE: SymptomCapture = {
  presentingComplaintKey: "chest_pain",
  onset: "gradual",
  severity: 7,
  associatedSymptoms: ["sweating"],
  triggers: [],
  relevantHistory: [],
  measurements: {},
};

export const CONTRACT_DEFAULT_CONFIG: SafeEngineConfig = {
  degraded: { ignore_severity_floors: true, unclassifiable_category: "urgent", engine_timeout_ms: 40 },
  month: 8,
  state: null,
};

const MILD: SymptomCapture = { presentingComplaintKey: "headache", onset: "gradual", severity: 2, associatedSymptoms: [], triggers: [], relevantHistory: [], measurements: {} };

function softened(result: EngineResult): EngineResult {
  return { ...result, category: "self_management", clinicianReviewRequired: false, redFlagScreen: { hasFlag: false, fired: [], brokenRules: [], topCategory: null } };
}

/** Decorate an adapter so it misbehaves in one named way. The contract applies every fault to the adapter under test. */
export function withFault(base: SymptomEngine, fault: ContractFault): SymptomEngine {
  if (fault === "none") return base;
  const milder = (s: EngineSession): EngineSession => ({ ...s, capture: { ...s.capture, severity: 1, associatedSymptoms: [], relevantHistory: [] } });
  const corrupt = async (step: Promise<EngineStep>): Promise<EngineStep> => {
    const s = await step;
    switch (fault) {
      case "softens":
        return s.kind === "complete" ? { ...s, result: softened(s.result) } : s;
      case "garbage":
        return { kind: "complete", result: { category: "all_clear" } as unknown as EngineResult, session: s.session };
      case "extra_fields":
        return s.kind === "complete" ? { ...s, result: { ...s.result, possibleCauses: [{ name: "Malaria", likelihood: 0.9 }] } as EngineResult } : s;
      case "swaps_capture":
        return s.kind === "complete" ? { ...s, result: softened(s.result), session: milder(s.session) } : s;
      default:
        return s;
    }
  };
  const fail = (): Promise<never> => {
    if (fault === "throws") throw new Error("adapter exploded");
    if (fault === "rejects") return Promise.reject(new Error("adapter unavailable"));
    return new Promise(() => undefined); // hangs
  };
  const broken = fault === "throws" || fault === "rejects" || fault === "hangs";
  return {
    engine: base.engine,
    engineVersion: base.engineVersion,
    start: (input: EngineInput) => (broken ? fail() : corrupt(base.start(input))),
    answer: (s: EngineSession, k: string, v: QuestionAnswer) => (broken ? fail() : corrupt(base.answer(s, k, v))),
    result: async (s: EngineSession) => {
      if (broken) return fail();
      if (fault === "garbage") return { category: "all_clear" } as unknown as EngineResult;
      const r = await base.result(s);
      if (fault === "softens" || fault === "swaps_capture") return softened(r);
      if (fault === "extra_fields") return { ...r, possibleCauses: [{ name: "Malaria", likelihood: 0.9 }] } as EngineResult;
      return r;
    },
  };
}

/** Removes /* ... *\/ comments in one linear pass (a lazy regular expression over input of this kind can run slowly on adversarial text). */
function stripBlockComments(source: string): string {
  let out = "";
  let i = 0;
  while (i < source.length) {
    const open = source.indexOf("/*", i);
    if (open === -1) return out + source.slice(i);
    out += source.slice(i, open);
    const close = source.indexOf("*/", open + 2);
    if (close === -1) return out + source.slice(open); // unterminated: keep the text so a forbidden name after it is still found
    i = close + 2;
  }
  return out;
}

/** Static half of INV-01: names that must not appear in an adapter's source. Returns the offending matches (empty is good). */
export function forbiddenModelOrNetworkUse(source: string): string[] {
  const code = stripBlockComments(source).replace(/(^|[^:])\/\/.*$/gm, "$1");
  const patterns: [string, RegExp][] = [
    ["anthropic", /anthropic/i],
    ["openai", /openai/i],
    ["a language model call", /\b(generateText|streamText|chat\.completions|messages\.create|runGovernedAi)\b/],
    ["fetch", /\bfetch\s*\(/],
    ["XMLHttpRequest", /XMLHttpRequest/],
    ["node http", /from ["'](node:)?https?["']/],
    ["Math.random", /Math\.random/],
  ];
  return patterns.filter(([, re]) => re.test(code)).map(([name]) => name);
}

export interface ContractOptions {
  name: string;
  /** A fresh adapter. */
  makeAdapter: () => SymptomEngine;
  config?: SafeEngineConfig;
  /** A capture the adapter can answer without a red flag; defaults to a mild headache. */
  benignCapture?: SymptomCapture;
  /** Answers to walk a benign session to its end. Default: answer every question "no" / the first option. */
  answerPolicy?: (question: { kind: "boolean" | "choice"; options?: { value: string }[] }) => QuestionAnswer;
}

export function runSymptomEngineContract(options: ContractOptions): void {
  const config = options.config ?? CONTRACT_DEFAULT_CONFIG;
  const benign = options.benignCapture ?? MILD;
  const policy = options.answerPolicy ?? ((q) => (q.kind === "boolean" ? false : (q.options?.[0]?.value ?? "")));
  const input = (capture: SymptomCapture): EngineInput => ({ capture, context: EMPTY_CONTEXT });

  async function walkToEnd(engine: ReturnType<typeof createSafeEngine>, capture: SymptomCapture) {
    let step = await engine.start(input(capture));
    let guard = 0;
    while (step.kind === "question" && guard++ < 50) {
      const q = step.question;
      step = await engine.answer(step.session, q.key, policy({ kind: q.kind, options: q.kind === "choice" ? q.options : undefined }));
    }
    return step;
  }

  describe(`SymptomEngine contract: ${options.name}`, () => {
    it("declares what it is", () => {
      const a = options.makeAdapter();
      expect(["internal", "licensed"]).toContain(a.engine);
      expect(a.engineVersion.length).toBeGreaterThan(0);
    });

    it("gives a result inside the contract for a benign case, and the same one twice (deterministic)", async () => {
      const first = await walkToEnd(createSafeEngine(options.makeAdapter(), config), benign);
      const second = await walkToEnd(createSafeEngine(options.makeAdapter(), config), benign);
      expect(first.kind).toBe("complete");
      if (first.kind !== "complete" || second.kind !== "complete") return;
      expect(["emergency", "urgent", "routine", "self_management"]).toContain(first.result.category);
      expect(first.result.category).toBe(second.result.category);
      expect(first.result.safetyNetMessageKey).toBe(second.result.safetyNetMessageKey);
    });

    describe.each(CONTRACT_FAULTS)("chest pain with sweating, adapter fault: %s", (fault) => {
      it("is emergency, whatever the adapter does", async () => {
        const safe = createSafeEngine(withFault(options.makeAdapter(), fault), config);
        const step = await safe.start(input(CONTRACT_EMERGENCY_CAPTURE));
        expect(step.kind).toBe("complete");
        if (step.kind !== "complete") return;
        expect(step.result.category).toBe("emergency");
        if (fault === "throws" || fault === "rejects" || fault === "hangs" || fault === "garbage") expect(step.result.clinicianReviewRequired).toBe(true);
        const viaResult = await safe.result(step.session);
        expect(viaResult.category).toBe("emergency");
      });
    });

    describe.each(["throws", "rejects", "hangs", "garbage"] as const)("a benign case with adapter fault: %s", (fault) => {
      it("escalates and asks a human to look, never all clear", async () => {
        const safe = createSafeEngine(withFault(options.makeAdapter(), fault), config);
        const step = await safe.start(input(benign));
        expect(step.kind).toBe("complete");
        if (step.kind !== "complete") return;
        expect(categoryAtLeast(step.result.category, "urgent")).toBe(true);
        expect(step.result.degraded).toBe(true);
        expect(step.result.clinicianReviewRequired).toBe(true);
      });
    });

    it("never lets an adapter soften its own red flag screen on a mid-walk answer", async () => {
      const safe = createSafeEngine(withFault(options.makeAdapter(), "softens"), config);
      const step = await safe.start(input({ ...CONTRACT_EMERGENCY_CAPTURE, severity: 7 }));
      expect(step.kind === "complete" && step.result.category).toBe("emergency");
    });

    it("drops anything outside the result contract (no possible causes ever reach a caller)", async () => {
      const safe = createSafeEngine(withFault(options.makeAdapter(), "extra_fields"), config);
      const end = await walkToEnd(safe, benign);
      expect(end.kind).toBe("complete");
      if (end.kind !== "complete") return;
      expect(Object.keys(end.result)).not.toContain("possibleCauses");
      const viaResult = await safe.result(end.session);
      expect(Object.keys(viaResult)).not.toContain("possibleCauses");
    });

    it("keeps the capture the person gave: an adapter cannot swap in a milder one", async () => {
      const safe = createSafeEngine(withFault(options.makeAdapter(), "swaps_capture"), config);
      const step = await safe.start(input(CONTRACT_EMERGENCY_CAPTURE));
      expect(step.session.capture).toEqual(CONTRACT_EMERGENCY_CAPTURE);
    });
  });
}
