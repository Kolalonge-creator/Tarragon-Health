/**
 * Drift guard for the bundled offline glucose classifier.
 *
 * apps/mobile/src/lib/glucose-red-flags.ts is a hand-maintained subset of
 * apps/web/src/lib/vitals/glucose-red-flags.ts (the authoritative ruleset,
 * fed server-side by assess-glucose.ts). The subset is deliberate — the
 * pattern bands need a trailing window of readings the phone doesn't have
 * offline — but the bands it DOES implement must fire at exactly the same
 * values, so the "go to the nearest hospital now" modal a patient sees with
 * no signal matches what the server would have said.
 *
 * The web classifier is imported rather than restated, so a threshold or
 * comparison change on either side fails here instead of drifting quietly.
 */
import {
  GLUCOSE_THRESHOLDS as WEB_GLUCOSE_THRESHOLDS,
  classifyGlucose as webClassifyGlucose,
} from "../../../web/src/lib/vitals/glucose-red-flags";
import { GLUCOSE_THRESHOLDS, classifyGlucoseOffline } from "./glucose-red-flags";

describe("lock-step with apps/web", () => {
  it("uses the exact same threshold values as the web copy", () => {
    expect(GLUCOSE_THRESHOLDS).toEqual(WEB_GLUCOSE_THRESHOLDS);
  });

  /**
   * The phone only ever ACTS on the emergency and urgent tiers (see
   * vitals.ts's classifyVitalOffline — amber drives no UI at all), so the
   * contract that matters is: for a single reading, mobile and web agree
   * exactly on whether it is emergency/urgent, and on which flag it is.
   * Swept across the whole plausible glucose range at 0.1 mmol/L steps plus
   * every ketone band boundary, because the realistic drift is an off-by-one
   * comparison at a band edge, not a changed constant.
   */
  it("agrees with the web classifier on every emergency/urgent single reading", () => {
    const ketones = [null, 0, 1.4, 1.5, 2.9, 3.0, 3.1, 6.0];
    const mismatches: string[] = [];

    for (let tenths = 5; tenths <= 350; tenths++) {
      const glucose = Number((tenths / 10).toFixed(1));
      for (const ketone of ketones) {
        const mine = classifyGlucoseOffline(glucose, ketone);
        const theirs = webClassifyGlucose({
          latestGlucose: glucose,
          latestKetoneMmol: ketone,
          latestKetoneUrine: null,
          recentGlucose: [],
        });
        const escalating = (tier: string) => tier === "emergency" || tier === "urgent";
        if (!escalating(mine.tier) && !escalating(theirs.tier)) continue;
        if (mine.tier !== theirs.tier || mine.kind !== theirs.kind) {
          mismatches.push(
            `glucose=${glucose} ketone=${ketone}: mobile=${mine.tier}/${mine.kind} web=${theirs.tier}/${theirs.kind}`
          );
        }
      }
    }
    expect(mismatches).toEqual([]);
  });

  /**
   * The one place the two deliberately differ, pinned so it stays a known,
   * bounded gap rather than becoming an unnoticed one. Moderate ketones
   * (1.5-2.9 with a non-alarming glucose) are an AMBER "review" band on the
   * server; the phone has no amber surface, so it reports none. If mobile
   * ever grows an amber UI, this expectation is the reminder that the band
   * exists and is currently unhandled.
   */
  it("does not implement the web amber ketones_moderate band", () => {
    expect(classifyGlucoseOffline(8, 2.0)).toEqual({ tier: "none", kind: "none", detail: "" });
    expect(
      webClassifyGlucose({
        latestGlucose: 8,
        latestKetoneMmol: 2.0,
        latestKetoneUrine: null,
        recentGlucose: [],
      })
    ).toMatchObject({ tier: "amber", kind: "ketones_moderate" });
  });
});

describe("classifyGlucoseOffline band boundaries", () => {
  it("flags severe hypoglycaemia below 3.0 mmol/L as an emergency", () => {
    expect(classifyGlucoseOffline(2.9, null)).toMatchObject({ tier: "emergency", kind: "severe_hypo" });
  });

  it("does not flag 3.0 itself as severe — that is the hypo-alert band", () => {
    expect(classifyGlucoseOffline(3.0, null)).toMatchObject({ tier: "urgent", kind: "hypo_alert" });
    expect(classifyGlucoseOffline(3.8, null)).toMatchObject({ tier: "urgent", kind: "hypo_alert" });
  });

  it("clears at 3.9, the top of the hypo-alert band", () => {
    expect(classifyGlucoseOffline(3.9, null).tier).toBe("none");
  });

  it("escalates a high glucose with raised ketones to suspected DKA", () => {
    expect(classifyGlucoseOffline(11.0, 3.0)).toMatchObject({ tier: "emergency", kind: "suspected_dka" });
    // One unit below either limb is not DKA.
    expect(classifyGlucoseOffline(10.9, 3.0)).toMatchObject({ tier: "urgent", kind: "ketones_raised" });
    expect(classifyGlucoseOffline(11.0, 2.9).tier).toBe("none");
  });

  it("treats >= 20 mmol/L as urgent on its own", () => {
    expect(classifyGlucoseOffline(20.0, null)).toMatchObject({ tier: "urgent", kind: "very_high" });
    expect(classifyGlucoseOffline(19.9, null).tier).toBe("none");
  });

  /**
   * The pathway's stated rule (web file's header): a missing ketone reading
   * must never downgrade or suppress a glucose flag. Most Nigerian patients
   * cannot test ketones at home, so this is the common case, not an edge one.
   */
  it("never lets an absent ketone reading suppress a glucose flag", () => {
    expect(classifyGlucoseOffline(25, null).tier).toBe("urgent");
    expect(classifyGlucoseOffline(2.0, null).tier).toBe("emergency");
  });

  it("raises ketones on their own once at or above 3.0 mmol/L", () => {
    expect(classifyGlucoseOffline(7, 3.0)).toMatchObject({ tier: "urgent", kind: "ketones_raised" });
    expect(classifyGlucoseOffline(7, 2.9).tier).toBe("none");
  });

  it("honours a caller-supplied threshold set (the threshold-sync path)", () => {
    const relaxed = { ...GLUCOSE_THRESHOLDS, severeHypo: 2.5, hypoAlert: 3.5 };
    expect(classifyGlucoseOffline(2.9, null, relaxed)).toMatchObject({ tier: "urgent", kind: "hypo_alert" });
    expect(classifyGlucoseOffline(2.4, null, relaxed)).toMatchObject({ tier: "emergency", kind: "severe_hypo" });
  });

  it("names the actual reading in the detail shown to the patient", () => {
    expect(classifyGlucoseOffline(2.1, null).detail).toContain("2.1");
    expect(classifyGlucoseOffline(24, null).detail).toContain("24");
  });
});
