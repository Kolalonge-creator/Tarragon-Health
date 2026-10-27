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
      if (["points.redeem.never_cash"].includes(k)) continue;
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

import { milestoneCopy, pendingActionLabel, pointsRuleLabel, pointsTierLabel } from "./points";
describe("points labels", () => {
  it("labels known codes and degrades unknown ones to plain words", () => {
    expect(pointsRuleLabel("lab_done")).toBe("Get a lab test done");
    expect(pointsRuleLabel("some_new_reason")).toBe("some new reason");
    expect(pointsTierLabel("leaf")).toBe("Leaf");
    expect(pointsTierLabel("unknown")).toBe("unknown");
  });
});

describe("S58b milestone and pending copy", () => {
  const codes = ["first_bp_logged", "first_glucose_logged", "adherence_4_weeks", "first_lab_done", "first_review_attended", "first_lesson_completed", "first_course_completed"];

  it("has a title and a body for every seeded milestone", () => {
    for (const c of codes) {
      const m = milestoneCopy(c);
      expect(m.title.length).toBeGreaterThan(5);
      expect(m.body.length).toBeGreaterThan(5);
      expect(m.title).not.toBe(milestoneCopy("not_a_code").title);
    }
  });

  it("an unknown code reads as a generic thank-you, never a key", () => {
    expect(milestoneCopy("brand_new_code").title).toBe("You took a real step in your care");
  });

  it("celebrates doing a step, never a body measure, a result or a comparison", () => {
    const text = codes.map((c) => `${milestoneCopy(c).title} ${milestoneCopy(c).body}`).join(" ");
    expect(text).not.toMatch(/\b(weight|bmi|waist|calorie|slim|lean|fat|kg|normal|abnormal|healthy range|in range|rank|leaderboard|beat|top)\b/i);
  });

  it("uses no em dash anywhere in the new copy", () => {
    const keys = (Object.keys(en) as (keyof typeof en)[]).filter((k) => /^points\.(milestone|pending)\./.test(k));
    expect(keys.length).toBeGreaterThan(15);
    for (const k of keys) expect([k, en[k].includes("\u2014")]).toEqual([k, false]);
  });

  it("labels a refund return and the first pending action", () => {
    expect(pointsRuleLabel("order_refunded")).toBe("Returned after a refund");
    expect(pendingActionLabel(["meal_logged"])).toBe("Log a meal");
  });
});
