import { recommendPlan } from "./plan-finder";

/**
 * The PlanFinder mapping is a pure function and a real conversion surface;
 * these tests pin the deliberate routing decisions:
 *
 * - a healthy visitor must land on Tarragon Prevent (the stay-healthy plan),
 *   never dead-end at Free (the pre-2026-07-23 behaviour);
 * - since removal 4, no answer may route to a household plan, because none
 *   exists to sell. "Someone I look after" gets that person's own individual
 *   plan plus an explanation of how paying for it works.
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
    expect(rec.price).toContain("$2.56");
  });

  it("still routes one condition to Essential Care", () => {
    expect(recommendPlan("me", "one", "nigeria").plan).toBe("Essential Care");
    expect(recommendPlan("me", "one", "abroad").plan).toBe("Essential Care (Diaspora)");
  });

  it("still routes multiple conditions to Complete Care", () => {
    expect(recommendPlan("me", "multiple", "nigeria").plan).toBe("Complete Care");
    expect(recommendPlan("me", "multiple", "abroad").plan).toBe("Complete Care (Diaspora)");
  });

  it("recommends the cared-for person's own plan, not a household one", () => {
    for (const health of ["none", "one", "multiple"] as const) {
      for (const from of ["nigeria", "abroad"] as const) {
        const mine = recommendPlan("me", health, from);
        const theirs = recommendPlan("someone-else", health, from);
        expect(theirs.plan).toBe(mine.plan);
        expect(theirs.price).toBe(mine.price);
      }
    }
  });

  it("explains individual enrolment when caring for someone else", () => {
    const rec = recommendPlan("someone-else", "one", "abroad");
    expect(rec.secondary).toContain("their own Tarragon account");
    expect(rec.secondary).toContain("Health Wallet");
  });

  it("never recommends a plan that no longer exists", () => {
    const retired = ["Family", "ParentCare", "Premium Care"];
    for (const who of ["me", "someone-else"] as const) {
      for (const health of ["none", "one", "multiple"] as const) {
        for (const from of ["nigeria", "abroad"] as const) {
          const rec = recommendPlan(who, health, from);
          const text = `${rec.plan} ${rec.secondary ?? ""}`;
          for (const name of retired) {
            expect(text).not.toContain(name);
          }
          // Pounds are retired as a currency, not just as a price.
          expect(`${rec.price} ${text}`).not.toContain("£");
        }
      }
    }
  });
});
