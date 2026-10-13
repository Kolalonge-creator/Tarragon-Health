import { describe, expect, it } from "@jest/globals";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  claimExpiresAt, handbackExcludesTask, handbackNeedsReview, inCooldown, makeReliabilityEvent, mapQueueError, mayBeOffered, orderTasks,
  reliabilityKindForCompletion, reliabilityKindForHandback, reliabilityScore, tierAtLeast, validateHandback,
  type ClinicianFacts, type CooldownRule, type OrderableTask, type ReliabilityEvent, type ReliabilityRules, type TaskFacts,
} from "../../../supabase/functions/_shared/queue/claims";

const HERE = fileURLToPath(new URL(".", import.meta.url));
interface Case { name: string; clinician?: Partial<ClinicianFacts>; task?: Partial<TaskFacts>; expect: boolean }
interface Fixture { defaults: { clinician: ClinicianFacts; task: TaskFacts }; cases: Case[] }
const fixture = JSON.parse(readFileSync(join(HERE, "..", "fixtures", "eligibility-cases.json"), "utf8")) as Fixture;
const RULES = { escalatedRequiresOnCall: true };

describe("mayBeOffered: the shared eligibility cases (the database proof runs the same file)", () => {
  for (const c of fixture.cases) {
    it(c.name, () => {
      const clinician = { ...fixture.defaults.clinician, ...c.clinician };
      const task = { ...fixture.defaults.task, ...c.task };
      expect(mayBeOffered(clinician, task, RULES)).toBe(c.expect);
    });
  }

  it("an escalated task needs no on_call when the rule is off", () => {
    const c = { ...fixture.defaults.clinician };
    const t = { ...fixture.defaults.task, state: "escalated" as const };
    expect(mayBeOffered(c, t, { escalatedRequiresOnCall: false })).toBe(true);
  });

  it("the proof embeds exactly the same cases (drift test)", () => {
    const proof = readFileSync(join(HERE, "..", "..", "db", "tests", "s17_queue_next.sql"), "utf8");
    const m = /cases-begin[\s\S]*?\$cases\$([\s\S]*?)\$cases\$/.exec(proof);
    if (!m?.[1]) throw new Error("cases block not found in the proof");
    expect(JSON.parse(m[1])).toEqual(fixture);
  });
});

describe("tierAtLeast", () => {
  it("follows the ladder", () => {
    expect(tierAtLeast("senior_medical_officer", "care_coordinator")).toBe(true);
    expect(tierAtLeast("care_coordinator", "senior_medical_officer")).toBe(false);
    expect(tierAtLeast("chief_medical_officer", "senior_medical_officer")).toBe(true);
  });
});

describe("orderTasks (spec 7.6)", () => {
  const t = (id: string, priorityClass: number, state: OrderableTask["state"], dueAt: number, createdAt: number): OrderableTask => ({ id, priorityClass, state, dueAt, createdAt });
  it("class first, then offered-to-me, then due time, then age; input untouched", () => {
    const input = [
      t("pool-4-late", 4, "open", 50, 1), t("class-2", 2, "open", 90, 9), t("offered-4", 4, "offered_to_lead", 90, 5),
      t("pool-4-early", 4, "open", 10, 8), t("pool-4-early-older", 4, "open", 10, 2),
    ];
    expect(orderTasks(input).map((x) => x.id)).toEqual(["class-2", "offered-4", "pool-4-early-older", "pool-4-early", "pool-4-late"]);
    expect(input[0]?.id).toBe("pool-4-late");
  });
});

describe("claimExpiresAt", () => {
  it("adds the type's timeout in minutes", () => expect(claimExpiresAt(1_000, 30)).toBe(1_000 + 30 * 60_000));
});

describe("validateHandback", () => {
  it("accepts each reasoned code", () => {
    for (const r of ["conflict_of_interest", "outside_competence", "needs_information", "technical_problem"]) expect(validateHandback(r, null)).toEqual({ ok: true });
  });
  it("rejects an unknown reason", () => expect(validateHandback("bored", null)).toEqual({ ok: false, error: "queue_bad_reason" }));
  it("other needs a note of 10 characters", () => {
    expect(validateHandback("other", null)).toEqual({ ok: false, error: "queue_note_needed" });
    expect(validateHandback("other", "too short")).toEqual({ ok: false, error: "queue_note_needed" });
    expect(validateHandback("other", "  ten chars!  ")).toEqual({ ok: true });
  });
});

describe("handbackNeedsReview", () => {
  it("flags only above the threshold", () => {
    expect(handbackNeedsReview(3, { moreThan: 3 })).toBe(false);
    expect(handbackNeedsReview(4, { moreThan: 3 })).toBe(true);
  });
});

describe("inCooldown", () => {
  const rule: CooldownRule = { count: 3, windowMinutes: 10, exemptReasons: ["conflict_of_interest", "technical_problem"], hardCount: 6, hardWindowMinutes: 60 };
  const now = 10 * 60_000 * 10;
  it("cools off at the count inside the window", () => {
    const recent = [1, 2, 3].map((i) => ({ reason: "outside_competence", at: now - i * 60_000 }));
    expect(inCooldown(recent, now, rule)).toBe(true);
  });
  it("ignores old and exempt hand-backs", () => {
    const recent = [
      { reason: "outside_competence", at: now - 30 * 60_000 }, { reason: "conflict_of_interest", at: now - 60_000 },
      { reason: "technical_problem", at: now - 60_000 }, { reason: "needs_information", at: now - 60_000 },
    ];
    expect(inCooldown(recent, now, rule)).toBe(false);
  });
});

describe("inCooldown hard cap and exclusion", () => {
  const rule: CooldownRule = { count: 3, windowMinutes: 10, exemptReasons: ["conflict_of_interest", "technical_problem"], hardCount: 6, hardWindowMinutes: 60 };
  const now = 100 * 60_000;
  it("exempt reasons still hit the hard cap, so they cannot re-roll without limit", () => {
    const six = Array.from({ length: 6 }, (_, i) => ({ reason: "technical_problem", at: now - (i + 1) * 5 * 60_000 }));
    expect(inCooldown(six, now, rule)).toBe(true);
    expect(inCooldown(six.slice(0, 5), now, rule)).toBe(false);
  });
  it("only permanent reasons exclude the task", () => {
    const ex = ["conflict_of_interest", "outside_competence", "other"];
    expect(handbackExcludesTask("technical_problem", ex)).toBe(false);
    expect(handbackExcludesTask("outside_competence", ex)).toBe(true);
  });
});

describe("reliability", () => {
  const rules: ReliabilityRules = {
    windowDays: 90, halfLifeDays: 30, priorEvents: 5, priorGood: 0.8,
    weights: { completed_on_time: 1, completed_late: 1, claim_expired: 0.5, handed_back_other: 0.25, handed_back_reasoned: 0 },
    good: { completed_on_time: 1, completed_late: 0.4, claim_expired: 0, handed_back_other: 0, handed_back_reasoned: 1 },
  };
  const now = 200 * 86_400_000;
  it("a new clinician sits at the prior", () => expect(reliabilityScore([], now, rules)).toBe(80));
  it("one on-time completion rises to 83.33", () => expect(reliabilityScore([makeReliabilityEvent("completed_on_time", now, rules)], now, rules)).toBe(83.33));
  it("one expired claim falls to 72.73", () => expect(reliabilityScore([makeReliabilityEvent("claim_expired", now, rules)], now, rules)).toBe(72.73));
  it("a reasoned hand-back changes nothing", () => expect(reliabilityScore([makeReliabilityEvent("handed_back_reasoned", now, rules)], now, rules)).toBe(80));
  it("an unknown kind weighs nothing", () => {
    const e = makeReliabilityEvent("audit_result", now, rules);
    expect(e).toEqual({ kind: "audit_result", at: now, weight: 0, good: 0 });
  });
  it("old events fade and events outside the window are dropped", () => {
    const old: ReliabilityEvent = makeReliabilityEvent("claim_expired", now - 30 * 86_400_000, rules);
    const gone: ReliabilityEvent = makeReliabilityEvent("claim_expired", now - 91 * 86_400_000, rules);
    expect(reliabilityScore([old], now, rules)).toBeGreaterThan(72.73);
    expect(reliabilityScore([gone], now, rules)).toBe(80);
  });
  it("kind helpers", () => {
    expect(reliabilityKindForHandback("other")).toBe("handed_back_other");
    expect(reliabilityKindForHandback("outside_competence")).toBe("handed_back_reasoned");
    expect(reliabilityKindForCompletion(5, 10)).toBe("completed_on_time");
    expect(reliabilityKindForCompletion(11, 10)).toBe("completed_late");
  });
});

describe("mapQueueError", () => {
  it("maps known codes and hides the rest", () => {
    expect(mapQueueError("queue_no_availability")).toEqual({ status: 409, code: "queue_no_availability" });
    expect(mapQueueError("queue_cooling_off extra text")).toEqual({ status: 429, code: "queue_cooling_off" });
    expect(mapQueueError("duplicate key value violates something")).toEqual({ status: 500, code: "queue_failed" });
    expect(mapQueueError("")).toEqual({ status: 500, code: "queue_failed" });
  });
});
