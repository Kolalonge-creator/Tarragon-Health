import { describe, expect, it } from "@jest/globals";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  ACTOR_KINDS,
  TASK_STATES,
  TRANSITIONS,
  canTransition,
  claimExpiry,
  classAfterPromotion,
  dueAt,
  isTerminal,
  meetsMinimumTier,
  movesFor,
  offerLapsed,
  offerWindowEnd,
  shouldEscalate,
  type PromotionInput,
  type TaskState,
} from "./index";

const MIN = 60_000;
const NOW = 1_800_000_000_000;

describe("transitions", () => {
  it("allows exactly the listed moves, and refuses every other (state, state, actor) triple", () => {
    let allowed = 0;
    for (const from of TASK_STATES) {
      for (const to of TASK_STATES) {
        for (const actor of ACTOR_KINDS) {
          const listed = TRANSITIONS.some((t) => t.from === from && t.to === to && t.actor === actor);
          expect(canTransition(from, to, actor)).toBe(listed);
          if (listed) allowed += 1;
        }
      }
    }
    expect(allowed).toBe(TRANSITIONS.length);
  });

  it("matches the migration's rule table, so the two cannot drift", () => {
    const dir = join(fileURLToPath(new URL(".", import.meta.url)), "..", "..", "..", "supabase", "migrations");
    const file = readdirSync(dir).find((f) => f.endsWith("_s16_clinical_tasks.sql"));
    if (!file) throw new Error("S16 migration not found");
    const sql = readFileSync(join(dir, file), "utf8");
    const block = /insert into public\.clinical_task_transition_rules[\s\S]*?;\n/.exec(sql)?.[0] ?? "";
    const seeded = [...block.matchAll(/\('([a-z_]+)', '([a-z_]+)', '([a-z]+)'\)/g)].map((m) => `${m[1]}>${m[2]}:${m[3]}`).sort();
    const coded = TRANSITIONS.map((t) => `${t.from}>${t.to}:${t.actor}`).sort();
    expect(seeded).toEqual(coded);
  });

  it("completed and cancelled are terminal and nothing leaves them", () => {
    for (const s of ["completed", "cancelled"] as TaskState[]) {
      expect(isTerminal(s)).toBe(true);
      expect(TRANSITIONS.filter((t) => t.from === s)).toHaveLength(0);
    }
    expect(isTerminal("open")).toBe(false);
  });

  it("only the clinical lead may cancel, from any live state", () => {
    for (const s of ["created", "offered_to_lead", "open", "claimed", "escalated"] as TaskState[]) {
      expect(canTransition(s, "cancelled", "lead")).toBe(true);
      expect(canTransition(s, "cancelled", "clinician")).toBe(false);
      expect(canTransition(s, "cancelled", "system")).toBe(false);
    }
  });

  it("a claim is only ever made by a clinician, and an escalated task can still be claimed", () => {
    expect(canTransition("open", "claimed", "system")).toBe(false);
    expect(canTransition("escalated", "claimed", "clinician")).toBe(true);
    expect(canTransition("completed", "claimed", "clinician")).toBe(false);
  });

  it("a claim is returned by the clinician (hand-back) or by the system (timeout), never directly to the lead window", () => {
    expect(canTransition("claimed", "open", "clinician")).toBe(true);
    expect(canTransition("claimed", "open", "system")).toBe(true);
    expect(canTransition("claimed", "offered_to_lead", "system")).toBe(false);
  });

  it("movesFor lists what an actor can do next", () => {
    expect(movesFor("open", "clinician")).toEqual(["claimed"]);
    expect(movesFor("claimed", "clinician").sort()).toEqual(["completed", "open"]);
    expect(movesFor("completed", "lead")).toEqual([]);
  });
});

describe("minimum tier (doctor tier is the only gate)", () => {
  it("orders coordinator < senior < chief", () => {
    expect(meetsMinimumTier("senior_medical_officer", "senior_medical_officer")).toBe(true);
    expect(meetsMinimumTier("care_coordinator", "senior_medical_officer")).toBe(false);
    expect(meetsMinimumTier("chief_medical_officer", "senior_medical_officer")).toBe(true);
  });
});

describe("times", () => {
  it("dueAt uses the rule's minutes, or the type default when the rule gives none", () => {
    expect(dueAt(NOW, 600, 1440)).toBe(NOW + 600 * MIN);
    expect(dueAt(NOW, null, 1440)).toBe(NOW + 1440 * MIN);
    expect(dueAt(NOW, undefined, 120)).toBe(NOW + 120 * MIN);
    expect(dueAt(NOW, 0, 1440)).toBe(NOW);
  });

  it("an offer window never passes the due time, and a red-class task never has one (INV-05)", () => {
    const due = NOW + 1440 * MIN;
    expect(offerWindowEnd(NOW, due, 240, 4)).toBe(NOW + 240 * MIN);
    expect(offerWindowEnd(NOW, NOW + 60 * MIN, 240, 4)).toBe(NOW + 60 * MIN);
    expect(offerWindowEnd(NOW, due, 240, 1)).toBeNull();
    expect(offerWindowEnd(NOW, due, 0, 4)).toBeNull();
  });

  it("claimExpiry adds the timeout", () => {
    expect(claimExpiry(NOW, 30)).toBe(NOW + 30 * MIN);
  });

  it("an offer lapses only while offered and once its window has ended", () => {
    expect(offerLapsed("offered_to_lead", NOW - 1, NOW)).toBe(true);
    expect(offerLapsed("offered_to_lead", NOW, NOW)).toBe(true);
    expect(offerLapsed("offered_to_lead", NOW + 1, NOW)).toBe(false);
    expect(offerLapsed("offered_to_lead", null, NOW)).toBe(false);
    expect(offerLapsed("open", NOW - 1, NOW)).toBe(false);
  });

  it("an offered or open task past due is escalated; a claimed, finished or not-yet-due one is not", () => {
    expect(shouldEscalate("open", NOW, NOW)).toBe(true);
    expect(shouldEscalate("offered_to_lead", NOW - 1, NOW)).toBe(true);
    expect(shouldEscalate("open", NOW + 1, NOW)).toBe(false);
    expect(shouldEscalate("claimed", NOW - 1, NOW)).toBe(false);
    expect(shouldEscalate("escalated", NOW - 1, NOW)).toBe(false);
    expect(shouldEscalate("completed", NOW - 1, NOW)).toBe(false);
  });
});

describe("class 3 promotion", () => {
  const base: PromotionInput = { type: "amber_bp_review", priorityClass: 4, originalClass: 4, state: "open", due: NOW + 100 * MIN, nowMs: NOW, windowMinutes: 240 };

  it("moves an amber review within the window to class 3", () => {
    expect(classAfterPromotion(base)).toBe(3);
    expect(classAfterPromotion({ ...base, due: NOW + 240 * MIN })).toBe(3);
    expect(classAfterPromotion({ ...base, state: "offered_to_lead" })).toBe(3);
    expect(classAfterPromotion({ ...base, state: "claimed" })).toBe(3);
  });

  it("leaves it alone outside the window, once promoted, when overridden, for another type, or when not live", () => {
    expect(classAfterPromotion({ ...base, due: NOW + 241 * MIN })).toBe(4);
    expect(classAfterPromotion({ ...base, priorityClass: 3 })).toBe(3);
    expect(classAfterPromotion({ ...base, priorityClass: 2 })).toBe(2);
    expect(classAfterPromotion({ ...base, originalClass: 5 })).toBe(4);
    expect(classAfterPromotion({ ...base, type: "symptom_review" })).toBe(4);
    expect(classAfterPromotion({ ...base, state: "escalated" })).toBe(4);
    expect(classAfterPromotion({ ...base, state: "completed" })).toBe(4);
  });
});
