import { describe, expect, it } from "@jest/globals";
import { COUNTERS, type WorklistCountKey } from "./worklist-counts";
import {
  LAUNCH_WORKLIST_BUCKET,
  WORKLIST_HREF,
  WORKLIST_LABEL,
  worklistKeysInBucket,
} from "./launch-worklist";

const ALL_KEYS = Object.keys(COUNTERS) as WorklistCountKey[];

describe("LAUNCH_WORKLIST_BUCKET", () => {
  it("classifies every real worklist counter into exactly one bucket", () => {
    // The load-bearing check: if worklist-counts.ts grows a new counter and
    // launch-worklist.ts isn't updated, this fails loudly rather than the
    // new worklist silently never appearing on the launch summary. The
    // Record<WorklistCountKey, ...> type already makes this a compile error
    // too — this test is the runtime companion, and the one that would
    // actually catch it in CI on a PR that doesn't run tsc against this
    // exact pair of files together.
    for (const key of ALL_KEYS) {
      expect(LAUNCH_WORKLIST_BUCKET[key]).toBeDefined();
    }
    expect(Object.keys(LAUNCH_WORKLIST_BUCKET).sort()).toEqual(ALL_KEYS.slice().sort());
  });

  it("gives every classified key a real href and label", () => {
    for (const key of Object.keys(LAUNCH_WORKLIST_BUCKET) as WorklistCountKey[]) {
      expect(WORKLIST_HREF[key]).toMatch(/^\/clinician\//);
      expect(WORKLIST_LABEL[key]).toBeTruthy();
    }
  });
});

describe("worklistKeysInBucket", () => {
  it("returns a non-empty list for each of the three buckets", () => {
    expect(worklistKeysInBucket("urgent").length).toBeGreaterThan(0);
    expect(worklistKeysInBucket("paidWorkDue").length).toBeGreaterThan(0);
    expect(worklistKeysInBucket("followUp").length).toBeGreaterThan(0);
  });

  it("partitions every key with no overlap and no gaps", () => {
    const urgent = worklistKeysInBucket("urgent");
    const paid = worklistKeysInBucket("paidWorkDue");
    const followUp = worklistKeysInBucket("followUp");
    expect(urgent.length + paid.length + followUp.length).toBe(ALL_KEYS.length);
    expect(new Set([...urgent, ...paid, ...followUp]).size).toBe(ALL_KEYS.length);
  });
});
