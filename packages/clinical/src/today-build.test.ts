import { describe, expect, it } from "@jest/globals";
import { getProposedConfig } from "@tarragon/shared";
import { buildToday, HomeCardConfigError, HOME_CARD_CODES, MAX_PRIMARY_ACTIONS, parseHomeCardConfig, type HomeCardConfig, type TodayFacts } from "./today-build";

const ENTRY = getProposedConfig("today.home_cards");
const CFG = parseHomeCardConfig(ENTRY.version, ENTRY.value);

const EMPTY: TodayFacts = {
  goals: [],
  pathways: [],
  hasDevice: false,
  task: null,
  medicines: null,
  readings: null,
  goal: null,
  lesson: null,
  assistantNudge: null,
  streak: null,
  weekly: null,
  readiness: null,
};
const facts = (over: Partial<TodayFacts>): TodayFacts => ({ ...EMPTY, ...over });

/** Everything that could ask for an action, all at once. */
const BUSY = facts({
  task: { openCount: 3, overdueCount: 0 },
  medicines: { pendingCount: 2 },
  readings: { loggedToday: false },
  goal: { metToday: false },
  lesson: { available: true },
  assistantNudge: { available: true },
  streak: { available: true },
  weekly: { available: true },
  hasDevice: true,
  readiness: { available: true },
});

describe("parseHomeCardConfig", () => {
  const good = () => JSON.parse(JSON.stringify(ENTRY.value)) as Record<string, unknown>;
  const refuses = (mutate: (v: Record<string, unknown>) => void) => {
    const v = good();
    mutate(v);
    expect(() => parseHomeCardConfig(1, v)).toThrow(HomeCardConfigError);
  };
  type Card = { code: unknown; priority: unknown; primary_eligible: unknown; rules: unknown };
  const cards = (v: Record<string, unknown>) => v["cards"] as Card[];

  it("reads the proposed configuration", () => {
    expect(CFG.maxPrimaryActions).toBe(2);
    expect(CFG.cards.map((c) => c.code)).toEqual([...HOME_CARD_CODES]);
    expect(CFG.streakEnabled).toBe(true);
  });
  it("refuses a configuration that is not an object", () => {
    expect(() => parseHomeCardConfig(1, null)).toThrow(HomeCardConfigError);
    expect(() => parseHomeCardConfig(1, [])).toThrow(HomeCardConfigError);
    expect(() => parseHomeCardConfig(1, "x")).toThrow(HomeCardConfigError);
  });
  it("refuses more than two primary actions, zero, a fraction and a non-number", () => {
    refuses((v) => (v["max_primary_actions"] = 3));
    refuses((v) => (v["max_primary_actions"] = 0));
    refuses((v) => (v["max_primary_actions"] = 1.5));
    refuses((v) => (v["max_primary_actions"] = "2"));
  });
  it("refuses a missing or empty card list", () => {
    refuses((v) => delete v["cards"]);
    refuses((v) => (v["cards"] = []));
  });
  it("refuses a bad card", () => {
    refuses((v) => (v["cards"] = ["x"]));
    refuses((v) => (cards(v)[0]!.code = "teleport"));
    refuses((v) => (cards(v)[0]!.code = 7));
    refuses((v) => (cards(v)[1]!.code = "task_due"));
    refuses((v) => (cards(v)[0]!.priority = -1));
    refuses((v) => (cards(v)[0]!.priority = 1.5));
    refuses((v) => (cards(v)[0]!.primary_eligible = "yes"));
    refuses((v) => (cards(v)[6]!.primary_eligible = true)); // streak only informs
    refuses((v) => (cards(v)[0]!.rules = null));
    refuses((v) => (cards(v)[0]!.rules = { goals_any: [], pathways_any: [] }));
    refuses((v) => (cards(v)[0]!.rules = { goals_any: "x", pathways_any: [], requires_device: false }));
    refuses((v) => (cards(v)[0]!.rules = { goals_any: [], pathways_any: [""], requires_device: false }));
  });
  it("refuses a missing streak switch", () => {
    refuses((v) => (v["streak"] = null));
    refuses((v) => (v["streak"] = { enabled: "yes" }));
  });
});

describe("buildToday: the Today screen never shows more than two primary actions", () => {
  it("shows two primary actions at most when everything is waiting", () => {
    const plan = buildToday(CFG, BUSY);
    expect(plan.primary.length).toBeLessThanOrEqual(MAX_PRIMARY_ACTIONS);
    expect(plan.primary.map((p) => p.code)).toEqual(["task_due", "medicines"]);
    expect(plan.primary.every((p) => p.state === "action")).toBe(true);
  });

  it("holds even if a configuration asked for more (the ceiling is applied again in code)", () => {
    const greedy: HomeCardConfig = { ...CFG, maxPrimaryActions: 9 };
    expect(buildToday(greedy, BUSY).primary).toHaveLength(MAX_PRIMARY_ACTIONS);
  });

  it("honours a lower limit of one", () => {
    const one: HomeCardConfig = { ...CFG, maxPrimaryActions: 1 };
    const plan = buildToday(one, BUSY);
    expect(plan.primary.map((p) => p.code)).toEqual(["task_due"]);
    expect(plan.secondary.map((p) => p.code)).toContain("medicines");
  });

  it("keeps every other shown card secondary, none lost", () => {
    const plan = buildToday(CFG, BUSY);
    expect(plan.secondary.map((p) => p.code)).toEqual(["readings", "goal", "lesson", "assistant_nudge", "streak", "weekly_summary", "readiness"]);
    expect(plan.hidden).toEqual([]);
    expect(plan.primary.length + plan.secondary.length + plan.hidden.length).toBe(HOME_CARD_CODES.length);
  });

  it("sweeps every combination of the six action cards: never more than two primary", () => {
    for (let mask = 0; mask < 128; mask += 1) {
      const f = facts({
        task: mask & 1 ? { openCount: 1, overdueCount: mask & 64 ? 1 : 0 } : null,
        medicines: mask & 2 ? { pendingCount: 1 } : null,
        readings: mask & 4 ? { loggedToday: false } : null,
        goal: mask & 8 ? { metToday: false } : null,
        lesson: mask & 16 ? { available: true } : null,
        assistantNudge: mask & 32 ? { available: true } : null,
      });
      expect(buildToday(CFG, f).primary.length).toBeLessThanOrEqual(2);
    }
  });
});

describe("buildToday: ordering", () => {
  it("puts an overdue task first even when its priority number is higher", () => {
    const shuffled: HomeCardConfig = {
      ...CFG,
      cards: CFG.cards.map((c) => (c.code === "task_due" ? { ...c, priority: 99 } : c)),
    };
    const plan = buildToday(shuffled, facts({ task: { openCount: 1, overdueCount: 1 }, medicines: { pendingCount: 1 }, readings: { loggedToday: false } }));
    expect(plan.primary.map((p) => p.code)).toEqual(["task_due", "medicines"]);
    expect(plan.primary[0]?.urgent).toBe(true);
  });

  it("orders by configured priority, then by code for ties", () => {
    const tied: HomeCardConfig = { ...CFG, cards: CFG.cards.map((c) => ({ ...c, priority: 1 })) };
    const plan = buildToday(tied, facts({ medicines: { pendingCount: 1 }, readings: { loggedToday: false }, goal: { metToday: false } }));
    expect(plan.primary.map((p) => p.code)).toEqual(["goal", "medicines"]);
    expect(plan.secondary.map((p) => p.code)).toEqual(["readings"]);
  });

  it("a task that is merely open is not urgent", () => {
    const plan = buildToday(CFG, facts({ task: { openCount: 2, overdueCount: 0 } }));
    expect(plan.primary[0]).toEqual({ code: "task_due", state: "action", urgent: false });
  });
});

describe("buildToday: what is shown", () => {
  it("shows nothing when nothing is known (an unknown hides a card, it is never guessed)", () => {
    const plan = buildToday(CFG, EMPTY);
    expect(plan.primary).toEqual([]);
    expect(plan.secondary).toEqual([]);
    expect(plan.hidden).toHaveLength(HOME_CARD_CODES.length);
  });

  it("hides a task card when no task is open", () => {
    expect(buildToday(CFG, facts({ task: { openCount: 0, overdueCount: 0 } })).hidden).toContain("task_due");
  });

  it("shows finished cards calmly as done, in the secondary list", () => {
    const plan = buildToday(CFG, facts({ medicines: { pendingCount: 0 }, readings: { loggedToday: true }, goal: { metToday: true } }));
    expect(plan.primary).toEqual([]);
    expect(plan.secondary.map((p) => [p.code, p.state])).toEqual([
      ["medicines", "done"],
      ["readings", "done"],
      ["goal", "done"],
    ]);
  });

  it("hides the lesson, the nudge and the information cards when they are not available", () => {
    const plan = buildToday(
      CFG,
      facts({
        lesson: { available: false },
        assistantNudge: { available: false },
        streak: { available: false },
        weekly: { available: false },
        hasDevice: true,
        readiness: { available: false },
      }),
    );
    expect(plan.secondary).toEqual([]);
  });

  it("shows information cards as info and never as a primary action", () => {
    const plan = buildToday(CFG, facts({ streak: { available: true }, weekly: { available: true } }));
    expect(plan.primary).toEqual([]);
    expect(plan.secondary.map((p) => [p.code, p.state])).toEqual([
      ["streak", "info"],
      ["weekly_summary", "info"],
    ]);
  });

  it("an action card that is not primary eligible stays secondary even when it is the only thing to do", () => {
    const plan = buildToday(CFG, facts({ lesson: { available: true } }));
    expect(plan.primary).toEqual([]);
    expect(plan.secondary).toEqual([{ code: "lesson", state: "action", urgent: false }]);
  });

  it("hides the streak card when the configuration switches it off", () => {
    const off: HomeCardConfig = { ...CFG, streakEnabled: false };
    const plan = buildToday(off, facts({ streak: { available: true } }));
    expect(plan.hidden).toContain("streak");
    expect(plan.secondary).toEqual([]);
  });

  it("carries the configuration version so a decision can name it", () => {
    expect(buildToday({ ...CFG, version: 7 }, EMPTY).configVersion).toBe(7);
  });
});

describe("buildToday: rules (goals, pathways, device)", () => {
  const withRules = (code: (typeof HOME_CARD_CODES)[number], rules: Partial<{ goalsAny: string[]; pathwaysAny: string[]; requiresDevice: boolean }>): HomeCardConfig => ({
    ...CFG,
    cards: CFG.cards.map((c) => (c.code === code ? { ...c, rules: { goalsAny: [], pathwaysAny: [], requiresDevice: false, ...rules } } : c)),
  });

  it("shows a pathway card only to someone on that pathway", () => {
    const cfg = withRules("readings", { pathwaysAny: ["hypertension"] });
    expect(buildToday(cfg, facts({ readings: { loggedToday: false }, pathways: ["diabetes"] })).hidden).toContain("readings");
    expect(buildToday(cfg, facts({ readings: { loggedToday: false } })).hidden).toContain("readings");
    expect(buildToday(cfg, facts({ readings: { loggedToday: false }, pathways: ["diabetes", "hypertension"] })).primary.map((p) => p.code)).toEqual(["readings"]);
  });

  it("shows a goal card only to someone with that goal", () => {
    const cfg = withRules("goal", { goalsAny: ["walk_more"] });
    expect(buildToday(cfg, facts({ goal: { metToday: false }, goals: ["eat_better"] })).hidden).toContain("goal");
    expect(buildToday(cfg, facts({ goal: { metToday: false }, goals: ["walk_more"] })).primary.map((p) => p.code)).toEqual(["goal"]);
  });

  it("never shows a device card to someone without a device", () => {
    const f = facts({ readiness: { available: true } });
    expect(buildToday(CFG, f).hidden).toContain("readiness");
    expect(buildToday(CFG, { ...f, hasDevice: true }).secondary.map((p) => p.code)).toEqual(["readiness"]);
  });

  it("a card with no device requirement shows without one", () => {
    expect(buildToday(CFG, facts({ weekly: { available: true } })).secondary.map((p) => p.code)).toEqual(["weekly_summary"]);
  });
});
