/**
 * Reference model of the SQL `private.challenge_aggregate` (S69, spec 17.7): the privacy maths for a cohort total, written once in plain
 * code so it can be tested without a database. The database is the source of truth; `packages/db/tests/s69_community_cohorts_and_challenges.sql`
 * proves the same cases there. It takes per-member effort sums as input (the database never sends these anywhere) and returns ONLY what a
 * cohort may see: no member id, no per-member figure, a band instead of a count.
 */
export type AggregateRules = {
  readonly min_contributors: number;
  readonly max_single_share_pct: number;
  readonly round_total_to: number;
  readonly progress_step_pct: number;
};

export type AggregateResult =
  | { readonly suppressed: true; readonly reason: "too_few" | "dominant_contributor" }
  | {
      readonly suppressed: false;
      readonly totalRounded: number;
      readonly progressPct: number;
      readonly goalReached: boolean;
      readonly contributorBand: "10-19" | "20-49" | "50-99" | "100+";
    };

export function aggregateChallenge(memberSums: readonly number[], targetPerMember: number, rules: AggregateRules): AggregateResult {
  const sums = memberSums.filter((s) => s > 0);
  const n = sums.length;
  if (n < rules.min_contributors) return { suppressed: true, reason: "too_few" };
  const total = sums.reduce((a, b) => a + b, 0);
  const max = Math.max(...sums);
  // leave-one-out: removing the biggest contributor would move the total by max/total, so a total whose biggest share is over the cap is hidden
  if (max * 100 > total * rules.max_single_share_pct) return { suppressed: true, reason: "dominant_contributor" };
  const ratio = (100 * total) / (targetPerMember * n);
  return {
    suppressed: false,
    totalRounded: Math.round(total / rules.round_total_to) * rules.round_total_to,
    progressPct: Math.min(100, Math.floor(ratio / rules.progress_step_pct) * rules.progress_step_pct),
    goalReached: ratio >= 100,
    contributorBand: n < 20 ? "10-19" : n < 50 ? "20-49" : n < 100 ? "50-99" : "100+",
  };
}
