import { getProposedConfig } from "@tarragon/shared";
import { answerTodayBuild, todayFactsSchema } from "./today-build-request";

const CONFIG = { version: 1, config: getProposedConfig("today.home_cards").value };
const FACTS = {
  goals: [],
  pathways: [],
  hasDevice: false,
  task: { openCount: 2, overdueCount: 0 },
  medicines: { pendingCount: 1 },
  readings: { loggedToday: false },
  goal: { metToday: false },
  lesson: { available: true },
  assistantNudge: { available: true },
  streak: null,
  weekly: null,
  readiness: null,
};

describe("answerTodayBuild (the server fallback)", () => {
  it("returns the same two-action plan the phone would build", () => {
    const answer = answerTodayBuild(CONFIG, todayFactsSchema.parse(FACTS));
    expect(answer.state).toBe("ready");
    if (answer.state !== "ready") return;
    expect(answer.plan.primary.map((p) => p.code)).toEqual(["task_due", "medicines"]);
    expect(answer.plan.primary.length).toBeLessThanOrEqual(2);
  });

  it("is hidden while the configuration is unsigned or unreadable", () => {
    const facts = todayFactsSchema.parse(FACTS);
    expect(answerTodayBuild(null, facts)).toEqual({ state: "hidden" });
    expect(answerTodayBuild({ version: "1", config: {} }, facts)).toEqual({ state: "hidden" });
    expect(answerTodayBuild({ version: 1, config: { max_primary_actions: 9 } }, facts)).toEqual({ state: "hidden" });
  });
});

describe("todayFactsSchema", () => {
  it("refuses a facts body with a missing or oversized part", () => {
    expect(todayFactsSchema.safeParse({ ...FACTS, task: { openCount: -1, overdueCount: 0 } }).success).toBe(false);
    expect(todayFactsSchema.safeParse({ ...FACTS, hasDevice: "yes" }).success).toBe(false);
    expect(todayFactsSchema.safeParse({ ...FACTS, goals: Array.from({ length: 60 }, () => "x") }).success).toBe(false);
    const missing: Record<string, unknown> = { ...FACTS };
    delete missing["readiness"];
    expect(todayFactsSchema.safeParse(missing).success).toBe(false);
  });
});
