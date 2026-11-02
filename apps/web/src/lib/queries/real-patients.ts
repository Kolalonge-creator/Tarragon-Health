import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@tarragon/shared";

type Client = SupabaseClient<Database>;

/**
 * INV-13: a test account (`profiles.is_test = true`) must never appear in a
 * real staff member's worklists or headline numbers. The database has no
 * shared helper for this yet, so every staff-facing count and list that
 * queries a table with a `patient_id` column goes through these two
 * functions rather than re-deriving "who is a test patient" in each file.
 *
 * `fetchTestPatientIds` returns the test patients the CALLER can see. RLS
 * already scopes `profiles` to the caller's organisation, so the synthetic
 * canary organisation's patients never reach a real staff member's client
 * in the first place; this list is for the test accounts that share a real
 * organisation with real patients (five of them next to four real patients
 * at the time of writing). The read throws on error, exactly like every
 * worklist counter: a failed read must surface as "could not be loaded",
 * never as "no test patients, so nothing to exclude".
 *
 * On the server, prefer `getTestPatientIdsForRequest` (real-patients-request.ts),
 * which wraps this in React.cache so one page's many reads share one query.
 */
export async function fetchTestPatientIds(supabase: Client): Promise<string[]> {
  const { data, error } = await supabase
    .from("profiles")
    .select("id")
    .eq("is_test", true)
    .eq("role", "patient");
  if (error) throw error;
  return (data ?? []).map((row) => row.id);
}

/**
 * The subset of the PostgREST filter builder this helper needs. Declared
 * structurally so the same function serves a `select(..., { head: true })`
 * count, a row fetch, and the stub builder in worklist-counts.test.ts.
 */
type FilterableQuery<Q> = {
  not(column: string, operator: string, value: unknown): Q;
  or(filters: string): Q;
};

export type ExcludeTestPatientsOptions = {
  /** The column holding the patient's profile id. Defaults to `patient_id`. */
  column?: string;
  /**
   * Set when the column is nullable (today only `clinical_incident_reports`).
   * PostgREST's `not.in` is SQL `NOT IN`, and `NULL NOT IN (...)` is NULL,
   * not true, so a plain `.not(...)` would silently drop every row that is
   * not about a patient at all. A nullable column gets `is.null OR not.in`
   * instead, which keeps those rows.
   */
  nullable?: boolean;
};

/**
 * Applies `.not("patient_id", "in", "(id1,id2,...)")` (PostgREST `in` list
 * syntax) only when there is something to exclude. An empty list returns the
 * query untouched, so a caller never pays for a no-op filter and the
 * generated URL stays identical to the pre-INV-13 one when no test patient
 * is visible.
 */
export function excludeTestPatients<Q extends FilterableQuery<Q>>(
  query: Q,
  testPatientIds: readonly string[],
  options: ExcludeTestPatientsOptions = {}
): Q {
  if (testPatientIds.length === 0) return query;
  const column = options.column ?? "patient_id";
  const list = `(${testPatientIds.join(",")})`;
  if (options.nullable) {
    return query.or(`${column}.is.null,${column}.not.in.${list}`);
  }
  return query.not(column, "in", list);
}
