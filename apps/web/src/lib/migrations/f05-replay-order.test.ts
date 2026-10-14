/**
 * Regression guard for the F-05 migration replay (PR #1037, fixed in #1057).
 *
 * The migration drops every function that has `doctor_tier` in its signature, rebuilds the enum, then recreates them. Two of those
 * functions (private.pick_employed_clinician, pick_employed_clinician_for) are SQL-language and call private.doctor_tier_rank, so
 * they are validated at creation and fail with `function private.doctor_tier_rank(doctor_tier) does not exist` if recreated first.
 * The capture order came from a heap scan of pg_proc, which moves with earlier CREATE OR REPLACE statements, so a fresh replay
 * failed on some runs and passed on others. The recreation loop must therefore order by an explicit dependency-first key, never by
 * capture order alone.
 */
import { readFileSync } from "node:fs";
import path from "node:path";

const FILE = path.resolve(
  __dirname,
  "../../../../../supabase/migrations/20261007235847_f05_retire_medical_officer_tier.sql",
);

function replayLoopOrderBy(sql: string): string {
  const m = sql.match(/for r in select \* from f05_swap order by ([^\n]*?) loop/);
  if (!m) throw new Error("F-05 replay loop over f05_swap not found");
  return m[1];
}

describe("F-05 migration replays deterministically", () => {
  const orderBy = replayLoopOrderBy(readFileSync(FILE, "utf8"));

  it("recreates private.doctor_tier_rank before any other function", () => {
    expect(orderBy).toContain("name not like 'private.doctor_tier_rank(%'");
    // the rank term must come before any further key, and after the kind order
    expect(orderBy.indexOf("array_position(v_kind_order, kind)")).toBeLessThan(
      orderBy.indexOf("name not like 'private.doctor_tier_rank(%'"),
    );
  });

  it("breaks remaining ties by a stable key, not by catalog scan order", () => {
    const keys = orderBy.split(/,(?![^(]*\))/).map((k) => k.trim());
    const afterRank = keys.slice(keys.findIndex((k) => k.includes("doctor_tier_rank")) + 1);
    expect(afterRank[0]).toBe("name");
  });
});
