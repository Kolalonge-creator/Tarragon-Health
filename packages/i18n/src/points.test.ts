import { describe, expect, it } from "@jest/globals";
import { en } from "./en";

const pointsKeys = (Object.keys(en) as (keyof typeof en)[]).filter((k) => k.startsWith("points."));

describe("points namespace copy (S58)", () => {
  it("exists", () => expect(pointsKeys.length).toBeGreaterThan(40));

  it("never frames a loss, a broken streak or guilt (no streak anxiety)", () => {
    const LOSS = /\b(lose|loses|losing|lost|break|broke|broken|miss|missed|missing|streak|keep it up|don't|do not give up|falling behind|behind|expire|expires|expired|run out)\b/i;
    for (const k of pointsKeys) {
      if (k === "points.redeem.never_cash") continue; // "never paid out as cash" is a rule, not a loss
      expect([k, LOSS.test(en[k])]).toEqual([k, false]);
    }
  });

  it("names no body size, weight, BMI or calories in anything a patient reads", () => {
    const BODY = /\b(weight|bmi|waist|calorie|calories|slim|fat|obese|obesity|thin|lean|kg)\b/i;
    for (const k of pointsKeys) {
      if (k === "points.admin.intro") continue; // the admin note states the rule that forbids them
      expect([k, BODY.test(en[k])]).toEqual([k, false]);
    }
  });

  it("never promises money or a points-to-naira rate and never compares people", () => {
    const MONEY = /(₦|naira|\bngn\b|per point|worth|cash value|rank|leaderboard|top earners|beat)/i;
    for (const k of pointsKeys) {
      if (["points.admin.leaderboards_off", "points.redeem.never_cash"].includes(k)) continue;
      expect([k, MONEY.test(en[k])]).toEqual([k, false]);
    }
  });

  it("has a label for every active rule code", () => {
    const codes = ["vitals_logged", "meal_logged", "adherence_checkin_completed", "education_lesson_completed", "lpe_task_completed", "lpe_goal_achieved",
      "challenge_completed", "wellness_class_attended", "course_completed", "lab_done", "review_attended", "screening_done"];
    for (const c of codes) expect(en[`points.rule.${c}` as keyof typeof en]).toBeTruthy();
  });

  it("never names a condition, reading or result in a rule label (INV-07: these labels may appear in a notification later)", () => {
    const CLINICAL = /(blood pressure|glucose|sugar|diabet|hypertens|result|reading|abnormal|normal|positive|negative)/i;
    for (const k of pointsKeys.filter((x) => x.startsWith("points.rule."))) {
      expect([k, CLINICAL.test(en[k])]).toEqual([k, false]);
    }
  });
});

import { pointsRuleLabel, pointsTierLabel } from "./points";
describe("points labels", () => {
  it("labels known codes and degrades unknown ones to plain words", () => {
    expect(pointsRuleLabel("lab_done")).toBe("Get a lab test done");
    expect(pointsRuleLabel("some_new_reason")).toBe("some new reason");
    expect(pointsTierLabel("leaf")).toBe("Leaf");
    expect(pointsTierLabel("unknown")).toBe("unknown");
  });
});
