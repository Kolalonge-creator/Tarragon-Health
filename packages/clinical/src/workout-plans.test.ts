import { describe, expect, it } from "@jest/globals";
import { getProposedConfig } from "@tarragon/shared";
import { orderPlans, planHasAudioSlot, sessionsWithinRange, type WorkoutPlanDisplayConfig, type WorkoutPlanLike } from "./workout-plans";

const cfg = getProposedConfig("activity.workout_plans").value as unknown as WorkoutPlanDisplayConfig;
const home = (code: string, minutes = 15): WorkoutPlanLike => ({ code, format: "home", sessions: [{ minutes }] });
const chair = (code: string, minutes = 15): WorkoutPlanLike => ({ code, format: "chair_class", sessions: [{ minutes }], audio_clip_ids: [] });

describe("workout plan display rules", () => {
  const plans = [home("a"), chair("b"), home("c"), chair("d")];

  it("lists chair-based classes first for an older adult, keeping order within each format", () => {
    expect(orderPlans(plans, cfg.older_adult_age, cfg).map((p) => p.code)).toEqual(["b", "d", "a", "c"]);
    expect(orderPlans(plans, 80, cfg).map((p) => p.code)).toEqual(["b", "d", "a", "c"]);
  });

  it("keeps the natural order for a younger adult or an unknown age", () => {
    expect(orderPlans(plans, cfg.older_adult_age - 1, cfg).map((p) => p.code)).toEqual(["a", "b", "c", "d"]);
    expect(orderPlans(plans, null, cfg).map((p) => p.code)).toEqual(["a", "b", "c", "d"]);
  });

  it("sessions are 10 to 20 minutes", () => {
    expect(cfg.session_minutes).toEqual({ min: 10, max: 20 });
    expect(sessionsWithinRange(home("x", 10), cfg)).toBe(true);
    expect(sessionsWithinRange(home("x", 20), cfg)).toBe(true);
    expect(sessionsWithinRange(home("x", 9), cfg)).toBe(false);
    expect(sessionsWithinRange(home("x", 21), cfg)).toBe(false);
  });

  it("audio is a slot only when a clip id is named; no plan has one today", () => {
    expect(planHasAudioSlot(home("a"))).toBe(false);
    expect(planHasAudioSlot(chair("b"))).toBe(false);
    expect(planHasAudioSlot({ ...chair("b"), audio_clip_ids: ["WKO-001"] })).toBe(true);
  });
});
