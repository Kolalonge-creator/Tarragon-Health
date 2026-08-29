import { recommendPlan } from "./plan-finder";
import { NGN_TIERS, USD_TIERS } from "../_content/pricing";

const carePass = NGN_TIERS.find((t) => t.id === "care_pass_12mo")!;
const familyWatch = USD_TIERS.find((t) => t.id === "family_watch")!;

/**
 * The PlanFinder mapping is a pure function and a real conversion surface;
 * these tests pin the deliberate routing decisions.
 *
 * Superseded 2026-08-29: Prevent/Essential/Complete are retired, replaced by
 * Care Pass — one product now, regardless of health condition count, so
 * "health" no longer changes which plan comes back in Nigeria, only its
 * "why" text. Diaspora ("abroad") has no live product yet (Family Watch
 * isn't built), so it must say so honestly rather than naming a plan that
 * doesn't exist.
 */
describe("recommendPlan", () => {
  it("routes anyone in Nigeria to Care Pass, whatever their health situation", () => {
    for (const health of ["none", "one", "multiple"] as const) {
      const rec = recommendPlan("me", health, "nigeria");
      expect(rec.plan).toBe("Care Pass");
      // Pulled live from _content/pricing.ts so this can't silently go stale
      // against the pricing table again (see 2026-08-12 marketing-site audit).
      expect(rec.price).toContain(carePass.priceMain);
    }
  });

  it("varies the why-text by health situation even though the plan is the same", () => {
    const none = recommendPlan("me", "none", "nigeria");
    const multiple = recommendPlan("me", "multiple", "nigeria");
    expect(none.why).not.toBe(multiple.why);
  });

  it("keeps Tarragon Free reachable as the explicit self-tracking alternative", () => {
    const rec = recommendPlan("me", "none", "nigeria");
    expect(rec.secondary).toContain("Tarragon Free");
  });

  it("routes an abroad payer to Family Watch, whatever their own health answer", () => {
    for (const health of ["none", "one", "multiple"] as const) {
      const rec = recommendPlan("me", health, "abroad");
      expect(rec.plan).toBe(familyWatch.name);
      expect(rec.price).toContain(familyWatch.priceSecondary!.replace(/^or\s+/, ""));
    }
  });

  it("tells a solo abroad payer Family Watch is for someone else, not themselves", () => {
    const rec = recommendPlan("me", "none", "abroad");
    expect(rec.secondary).toContain("someone else's care");
  });

  it("recommends the cared-for person's own plan, not a household one", () => {
    for (const health of ["none", "one", "multiple"] as const) {
      const mine = recommendPlan("me", health, "nigeria");
      const theirs = recommendPlan("someone-else", health, "nigeria");
      expect(theirs.plan).toBe(mine.plan);
      expect(theirs.price).toBe(mine.price);
    }
  });

  it("explains individual enrolment when caring for someone else, in Nigeria or abroad", () => {
    for (const from of ["nigeria", "abroad"] as const) {
      const rec = recommendPlan("someone-else", "one", from);
      expect(rec.secondary).toContain("their own Tarragon account");
      expect(rec.secondary).toContain("fund their plan");
    }
  });

  it("never recommends a plan that no longer exists", () => {
    // "Family" alone is too broad a substring now that "Tarragon Family
    // Watch" is a real, current product — check the retired household-plan
    // names specifically instead.
    const retired = ["Family Lite", "Family Plus", "Family Premium", "ParentCare", "Premium Care", "Tarragon Prevent", "Essential Care", "Complete Care"];
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
