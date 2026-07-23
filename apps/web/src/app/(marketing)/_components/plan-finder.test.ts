import { recommendPlan } from "./plan-finder";

/**
 * The PlanFinder mapping is a pure function and a real conversion surface —
 * these tests pin the deliberate routing decisions, especially the
 * prevention-first ones: a healthy visitor must land on Tarragon Prevent
 * (the stay-healthy plan), never dead-end at Free (the pre-2026-07-23
 * behaviour this branch fixed).
 */
describe("recommendPlan", () => {
  it("routes a healthy person in Nigeria to Tarragon Prevent", () => {
    const rec = recommendPlan("me", "none", "nigeria");
    expect(rec.plan).toBe("Tarragon Prevent");
    expect(rec.price).toContain("₦3,500");
    // Free stays reachable as the explicit self-tracking alternative.
    expect(rec.secondary).toContain("Tarragon Free");
    expect(rec.secondary).toContain("Annual Health Check");
  });

  it("routes a healthy person abroad to the diaspora Prevent plan", () => {
    const rec = recommendPlan("me", "none", "abroad");
    expect(rec.plan).toBe("Tarragon Prevent (Diaspora)");
    expect(rec.price).toContain("£7");
  });

  it("still routes one condition to Essential Care", () => {
    expect(recommendPlan("me", "one", "nigeria").plan).toBe("Essential Care");
    expect(recommendPlan("me", "one", "abroad").plan).toBe("Essential Care (Diaspora)");
  });

  it("still routes multiple conditions to Complete Care", () => {
    expect(recommendPlan("me", "multiple", "nigeria").plan).toBe("Complete Care");
    expect(recommendPlan("me", "multiple", "abroad").plan).toBe("Complete Care (Diaspora)");
  });

  it("routes parents to ParentCare regardless of health answer", () => {
    expect(recommendPlan("parents", "none", "nigeria").plan).toBe("ParentCare");
    expect(recommendPlan("parents", "multiple", "abroad").plan).toBe("ParentCare (Diaspora)");
  });

  it("routes families by condition load", () => {
    expect(recommendPlan("family", "none", "nigeria").plan).toBe("Family Lite");
    expect(recommendPlan("family", "multiple", "nigeria").plan).toBe("Family Plus");
    expect(recommendPlan("family", "none", "abroad").plan).toBe("Family Lite (Diaspora)");
    expect(recommendPlan("family", "multiple", "abroad").plan).toBe("Family Plus (Diaspora)");
  });
});
