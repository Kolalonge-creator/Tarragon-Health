/**
 * S59c follow-up check-back: the pure decision table. The database proof (`s59c_assessment_ux.sql`) pins the same table.
 */
import { describe, it, expect } from "@jest/globals";
import { TRIAGE_CATEGORIES, type TriageCategory } from "../types/index";
import { CHECKBACK_DRAFT } from "./drafts";
import {
  CARE_OPTIONS,
  CHECKBACK_ACTIONS,
  PROGRESS_OPTIONS,
  checkbackActionRank,
  checkbackConfigSchema,
  checkbackDelayHours,
  decideCheckback,
  floorForAnswer,
  type CheckbackAnswers,
} from "./checkback";
import type { SymptomCapture } from "../types/index";

const SIGNED = { ...CHECKBACK_DRAFT, status: "signed_off", clinical_sign_off: { by: "Test CMO", at: "2026-10-22" } };

describe("scheduling", () => {
  it("the shipped draft parses, is unsigned, and schedules nothing", () => {
    const parsed = checkbackConfigSchema.parse(CHECKBACK_DRAFT);
    expect(parsed.status).toBe("draft");
    expect(parsed.clinical_sign_off).toBeNull();
    for (const c of TRIAGE_CATEGORIES) expect(checkbackDelayHours(c, CHECKBACK_DRAFT)).toBeNull();
  });

  it("signed: only self-care and routine results get a check-back, each after its own delay (24 to 48 hours)", () => {
    expect(checkbackDelayHours("self_management", SIGNED)).toBe(48);
    expect(checkbackDelayHours("routine", SIGNED)).toBe(24);
    expect(checkbackDelayHours("urgent", SIGNED)).toBeNull();
    expect(checkbackDelayHours("emergency", SIGNED)).toBeNull();
  });

  it("a malformed config schedules nothing", () => {
    expect(checkbackDelayHours("routine", { ...SIGNED, categories: {} })).toBeNull();
    expect(checkbackDelayHours("routine", null)).toBeNull();
    expect(checkbackDelayHours("routine", { ...SIGNED, notification_window: { start_hour: 21, end_hour: 7 } })).toBeNull();
  });

  it("allows one reminder at most", () => {
    expect(checkbackConfigSchema.safeParse({ ...SIGNED, max_nudges: 2 }).success).toBe(false);
  });
});

const ctx = { hoursSinceCheck: 30, sameNudgeAfterHours: 24 };
const ans = (over: Partial<CheckbackAnswers> = {}): CheckbackAnswers => ({ progress: "better", careReceived: null, newSigns: [], floorCategory: null, ...over });

describe("the decision table", () => {
  it("better with nothing new closes", () => expect(decideCheckback(ans(), ctx)).toBe("close"));
  it("same before the nudge time keeps watching", () => expect(decideCheckback(ans({ progress: "same" }), { hoursSinceCheck: 10, sameNudgeAfterHours: 24 })).toBe("keep_watching"));
  it("same at or after the nudge time points to a booking", () => {
    expect(decideCheckback(ans({ progress: "same" }), { hoursSinceCheck: 24, sameNudgeAfterHours: 24 })).toBe("book");
    expect(decideCheckback(ans({ progress: "same" }), ctx)).toBe("book");
  });
  it("worse escalates", () => expect(decideCheckback(ans({ progress: "worse" }), ctx)).toBe("escalate"));
  it("a newly ticked sign escalates even when the person says better", () => expect(decideCheckback(ans({ newSigns: ["confusion"] }), ctx)).toBe("escalate"));
  it("the floor saying urgent escalates", () => expect(decideCheckback(ans({ floorCategory: "urgent" }), ctx)).toBe("escalate"));
  it("the floor saying emergency is an emergency, whatever else was said", () => {
    for (const progress of PROGRESS_OPTIONS) expect(decideCheckback(ans({ progress, floorCategory: "emergency" }), ctx)).toBe("emergency");
  });
  it("did you get care changes nothing", () => {
    for (const care of CARE_OPTIONS) for (const progress of PROGRESS_OPTIONS) {
      expect(decideCheckback(ans({ progress, careReceived: care }), ctx)).toBe(decideCheckback(ans({ progress, careReceived: null }), ctx));
    }
  });
});

describe("property: more signal never lowers the action", () => {
  const floors: (TriageCategory | null)[] = [null, "self_management", "routine", "urgent", "emergency"];
  const signs = [[], ["confusion"], ["confusion", "vision_loss"]];
  const hours = [0, 10, 24, 30, 100];
  const all: { a: CheckbackAnswers; h: number }[] = [];
  for (const progress of PROGRESS_OPTIONS) for (const floorCategory of floors) for (const newSigns of signs) for (const h of hours) {
    all.push({ a: { progress, newSigns, floorCategory, careReceived: null }, h });
  }
  const rank = (x: { a: CheckbackAnswers; h: number }) => checkbackActionRank(decideCheckback(x.a, { hoursSinceCheck: x.h, sameNudgeAfterHours: 24 }));

  it("worsening the progress answer, adding a sign or raising the floor never lowers the action", () => {
    const order = { better: 0, same: 1, worse: 2 } as const;
    const floorRank = (f: TriageCategory | null) => floors.indexOf(f);
    for (const x of all) for (const y of all) {
      if (x.h !== y.h) continue;
      const moreSevere = order[y.a.progress] >= order[x.a.progress] && y.a.newSigns.length >= x.a.newSigns.length && floorRank(y.a.floorCategory) >= floorRank(x.a.floorCategory);
      if (moreSevere) expect(rank(y)).toBeGreaterThanOrEqual(rank(x));
    }
  });

  it("closes only when the answer is better, nothing new was ticked and the floor fired nothing", () => {
    for (const x of all) {
      const action = decideCheckback(x.a, { hoursSinceCheck: x.h, sameNudgeAfterHours: 24 });
      if (action === "close") {
        expect(x.a.progress).toBe("better");
        expect(x.a.newSigns).toHaveLength(0);
        expect(x.a.floorCategory === null || x.a.floorCategory === "self_management" || x.a.floorCategory === "routine").toBe(true);
      }
    }
  });

  it("every action is one of the five, and 'worse' or a sign is always at least escalate", () => {
    for (const x of all) {
      const action = decideCheckback(x.a, { hoursSinceCheck: x.h, sameNudgeAfterHours: 24 });
      expect(CHECKBACK_ACTIONS).toContain(action);
      if (x.a.progress === "worse" || x.a.newSigns.length > 0 || x.a.floorCategory === "urgent" || x.a.floorCategory === "emergency") {
        expect(checkbackActionRank(action)).toBeGreaterThanOrEqual(checkbackActionRank("escalate"));
      }
    }
  });
});

describe("floorForAnswer: the red-flag floor re-run on the original answers plus what is newly ticked", () => {
  const headache: SymptomCapture = { presentingComplaintKey: "headache", onset: "gradual", severity: 4, associatedSymptoms: ["nausea_vomiting"], triggers: [], relevantHistory: [], measurements: {} };
  it("is null when nothing newly ticked fires a rule", () => {
    expect(floorForAnswer(headache, [])).toBeNull();
    expect(floorForAnswer(headache, ["fever"])).toBeNull();
  });
  it("fires the signed rules on the combination", () => {
    expect(floorForAnswer(headache, ["confusion"])).toBe("emergency");
    expect(floorForAnswer(headache, ["fever", "neck_stiffness"])).toBe("emergency");
  });
  it("re-evaluates the chest pain pattern from the stored answers", () => {
    const chest: SymptomCapture = { ...headache, presentingComplaintKey: "chest_pain", severity: 7, associatedSymptoms: [] };
    expect(floorForAnswer(chest, [])).toBeNull();
    expect(floorForAnswer(chest, ["sweating"])).toBe("emergency");
  });
  it("property: more ticked never lowers the floor", () => {
    const rank = (c: string | null) => (c === "emergency" ? 2 : c === "urgent" ? 1 : 0);
    const all = ["fever", "neck_stiffness", "visual_disturbance", "vision_loss", "weakness_or_numbness", "confusion", "nausea_vomiting"];
    for (let mask = 0; mask < 1 << all.length; mask++) {
      const signs = all.filter((_, i) => mask & (1 << i));
      for (let extra = 0; extra < all.length; extra++) {
        expect(rank(floorForAnswer(headache, [...signs, all[extra]!]))).toBeGreaterThanOrEqual(rank(floorForAnswer(headache, signs)));
      }
    }
  });
  it("a capture the floor cannot read still treats any ticked sign as urgent", () => {
    const broken = { ...headache, associatedSymptoms: null } as unknown as SymptomCapture;
    expect(floorForAnswer(broken, ["fever"])).toBe("urgent");
    expect(floorForAnswer(broken, [])).toBeNull();
  });
});
