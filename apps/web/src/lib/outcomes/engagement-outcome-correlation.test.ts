import { describe, expect, it } from "@jest/globals";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@tarragon/shared";
import { loadEngagementOutcomeCorrelation } from "./engagement-outcome-correlation";

type Row = Record<string, unknown>;

/** Minimal chainable fake: select/eq/order return `this`, awaiting resolves to {data, error}. */
function fakeClient(tables: Record<string, { data: Row[] | null; error: unknown }>) {
  return {
    from: (table: string) => {
      const result = tables[table] ?? { data: [], error: null };
      const builder = {
        select: () => builder,
        eq: () => builder,
        order: () => Promise.resolve(result),
      };
      return builder;
    },
  } as unknown as SupabaseClient<Database>;
}

describe("loadEngagementOutcomeCorrelation", () => {
  it("returns null if either query errors", async () => {
    const client = fakeClient({
      patient_engagement_scores: { data: null, error: new Error("boom") },
      patient_risk_scores: { data: [], error: null },
    });
    expect(await loadEngagementOutcomeCorrelation(client, "org1", 5)).toBeNull();
  });

  it("buckets by tier, taking the latest tier and latest bp_control level per patient", async () => {
    const client = fakeClient({
      patient_engagement_scores: {
        data: [
          // p1's latest (most recent computed_at first, matches .order desc) is highly_engaged.
          { patient_id: "p1", tier: "highly_engaged", computed_at: "2026-08-30T00:00:00Z" },
          { patient_id: "p1", tier: "at_risk", computed_at: "2026-08-29T00:00:00Z" },
          { patient_id: "p2", tier: "disengaged", computed_at: "2026-08-30T00:00:00Z" },
          { patient_id: "p3", tier: "highly_engaged", computed_at: "2026-08-30T00:00:00Z" },
        ],
        error: null,
      },
      patient_risk_scores: {
        data: [
          { patient_id: "p1", risk_level: "low", computed_at: "2026-08-30T00:00:00Z" },
          { patient_id: "p2", risk_level: "high", computed_at: "2026-08-30T00:00:00Z" },
          // p3 has an engagement tier but no bp_control score at all — must be excluded entirely.
        ],
        error: null,
      },
    });

    const result = await loadEngagementOutcomeCorrelation(client, "org1", 5);
    expect(result).not.toBeNull();
    expect(result).toHaveLength(2);

    const highly = result!.find((b) => b.tier === "highly_engaged");
    expect(highly).toMatchObject({ cohortSize: 1, bpInRangeCount: 1 });

    const disengaged = result!.find((b) => b.tier === "disengaged");
    expect(disengaged).toMatchObject({ cohortSize: 1, bpInRangeCount: 0 });

    expect(result!.some((b) => b.tier === "moderately_engaged" || b.tier === "at_risk")).toBe(false);
  });

  it("suppresses a bucket below the organisation's minimum cohort size", async () => {
    const client = fakeClient({
      patient_engagement_scores: {
        data: [
          { patient_id: "p1", tier: "highly_engaged", computed_at: "2026-08-30T00:00:00Z" },
          { patient_id: "p2", tier: "highly_engaged", computed_at: "2026-08-30T00:00:00Z" },
        ],
        error: null,
      },
      patient_risk_scores: {
        data: [
          { patient_id: "p1", risk_level: "low", computed_at: "2026-08-30T00:00:00Z" },
          { patient_id: "p2", risk_level: "low", computed_at: "2026-08-30T00:00:00Z" },
        ],
        error: null,
      },
    });

    const result = await loadEngagementOutcomeCorrelation(client, "org1", 5);
    const highly = result!.find((b) => b.tier === "highly_engaged");
    expect(highly).toMatchObject({ cohortSize: 2, suppressed: true });
  });

  it("returns an empty array, not null, when there is simply no data yet", async () => {
    const client = fakeClient({
      patient_engagement_scores: { data: [], error: null },
      patient_risk_scores: { data: [], error: null },
    });
    expect(await loadEngagementOutcomeCorrelation(client, "org1", 5)).toEqual([]);
  });
});
