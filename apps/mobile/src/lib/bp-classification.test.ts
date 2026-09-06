/**
 * Drift guard for the bundled BP badge classifier.
 *
 * apps/mobile/src/lib/bp-classification.ts is a hand-maintained COPY of
 * apps/web/src/lib/rules/bp-classification.ts, which is itself a copy of the
 * authoritative DB trigger `private.classify_bp_level`
 * (supabase/migrations/20260720015223_bp_red_flag_engine.sql). Three copies
 * of one clinical rule can only stay honest if something fails when they
 * disagree — that is what this file is for. The web copy is imported
 * directly (not restated) so a change on either side is caught, not just a
 * change the test author remembered to mirror.
 */
import {
  BP_LEVEL_LABEL as WEB_BP_LEVEL_LABEL,
  BP_THRESHOLDS as WEB_BP_THRESHOLDS,
  classifyBpLevel as webClassifyBpLevel,
} from "../../../web/src/lib/rules/bp-classification";
import { BP_LEVEL_LABEL, BP_THRESHOLDS, classifyBpLevel, type BpLevel } from "./bp-classification";

describe("lock-step with apps/web (and therefore with private.classify_bp_level)", () => {
  it("uses the exact same threshold values as the web copy", () => {
    expect(BP_THRESHOLDS).toEqual(WEB_BP_THRESHOLDS);
  });

  it("shows the same badge labels as the web copy", () => {
    expect(BP_LEVEL_LABEL).toEqual(WEB_BP_LEVEL_LABEL);
  });

  /**
   * Value-by-value rather than a handful of samples: a drift is far more
   * likely to be a changed comparison (`>` vs `>=`), a swapped systolic/
   * diastolic, or a reordered band than a changed constant, and none of
   * those show up in a threshold-equality check.
   */
  it("classifies every plausible reading identically to the web copy", () => {
    const mismatches: string[] = [];
    for (let systolic = 70; systolic <= 260; systolic++) {
      for (let diastolic = 30; diastolic <= 160; diastolic++) {
        const mine = classifyBpLevel(systolic, diastolic);
        const theirs = webClassifyBpLevel(systolic, diastolic);
        if (mine !== theirs) mismatches.push(`${systolic}/${diastolic}: mobile=${mine} web=${theirs}`);
      }
    }
    expect(mismatches).toEqual([]);
  });
});

describe("classifyBpLevel band boundaries", () => {
  /**
   * Pinned against the SQL in 20260720015223_bp_red_flag_engine.sql:
   *   diastolic >= 120 or systolic >= 200 -> emergency
   *   systolic  >= 160 or diastolic >= 100 -> red
   *   systolic  >= 135 or diastolic >= 85  -> amber
   *   else green
   * Each pair below is the exact value that trips a band and the exact value
   * one unit below it that must not.
   */
  const cases: [number, number, BpLevel][] = [
    // Emergency — either limb alone is enough.
    [200, 80, "emergency"],
    [199, 80, "red"],
    [100, 120, "emergency"],
    [100, 119, "red"],
    // Red.
    [160, 80, "red"],
    [159, 80, "amber"],
    [120, 100, "red"],
    [120, 99, "amber"],
    // Amber.
    [135, 80, "amber"],
    [134, 80, "green"],
    [120, 85, "amber"],
    [120, 84, "green"],
    // Green.
    [110, 70, "green"],
  ];

  it.each(cases)("classifies %i/%i as %s", (systolic, diastolic, expected) => {
    expect(classifyBpLevel(systolic, diastolic)).toBe(expected);
  });

  it("returns unknown rather than guessing when either limb is missing", () => {
    expect(classifyBpLevel(null, 80)).toBe("unknown");
    expect(classifyBpLevel(180, null)).toBe("unknown");
    expect(classifyBpLevel(undefined, undefined)).toBe("unknown");
  });

  it("never treats a 0 reading as missing (0 is a value, not an absence)", () => {
    expect(classifyBpLevel(0, 0)).toBe("green");
  });

  it("escalates on the more severe limb, not the systolic one", () => {
    // A normal systolic with a crisis diastolic must still be emergency —
    // the failure mode if someone rewrites this as a systolic-first ladder.
    expect(classifyBpLevel(118, 125)).toBe("emergency");
  });

  it("honours a caller-supplied threshold set (the threshold-sync path)", () => {
    const relaxed = {
      emergency: { systolic: 220, diastolic: 130 },
      red: { systolic: 170, diastolic: 110 },
      amber: { systolic: 140, diastolic: 90 },
    } as const;
    expect(classifyBpLevel(200, 80, relaxed)).toBe("red");
    expect(classifyBpLevel(136, 86, relaxed)).toBe("green");
  });
});
