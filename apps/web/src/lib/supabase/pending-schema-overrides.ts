import { createClient } from "@/lib/supabase/client";

/**
 * Medication-management-system additions (2026-08-28) that are live in
 * `supabase/migrations/` but postdate the last `database.types.ts`
 * regeneration in `packages/shared`:
 *   - medications: replaces_medication_id, stopped_by_profile_id
 *     (20260828021520_medications_replacement_and_stopped_by.sql)
 *   - medication_logs: 4 new status values + access_barrier_reason
 *     (20260828021500_medication_log_status_extended_values.sql,
 *      20260828021510_medication_logs_access_barrier.sql)
 *   - medication_reviews: 7 structured domain columns
 *     (20260828021550_medication_reviews_structured_domains.sql)
 *   - medication_side_effect_reports: whole new table
 *     (20260828021600_medication_side_effect_reports.sql)
 *   - raise_medication_safety_alert: whole new RPC
 *     (20260828021620_medication_safety_manual_alert_rpc.sql)
 *
 * supabase-js's typed `.insert()`/`.update()`/`.rpc()` reject any argument
 * carrying a property the GENERATED type doesn't know about — via its own
 * `RejectExcessProperties` utility, which (unlike TypeScript's built-in
 * excess-property check) also fires for a widened variable, not just a
 * fresh literal, so there is no safe way to smuggle a new column through
 * the normally-typed call. And attempting to extend the whole generated
 * `Database` type and re-type the client against it (tried first) breaks
 * that same generic resolution for EVERY table on the client, not just the
 * touched ones — a much wider blast radius than intended.
 *
 * The fix here is narrower: reads (`.select()`) against these tables need
 * no help at all — the generated columns/table are already there, this
 * migration set is purely additive, and every read result in this codebase
 * is already force-cast to a hand-maintained interface anyway (e.g.
 * `data as MedicationWithCarePlan[]`). Only the specific `.insert()`/
 * `.update()`/`.rpc()` calls that pass a genuinely new column, value, or
 * function need an escape hatch — `writableTable()`/`callRpc()` below view
 * just the ONE table/function involved through a minimal, deliberately
 * loose interface (never `any`, per CLAUDE.md), scoped to exactly that
 * call. Every other call in these files keeps using the fully-typed
 * `createClient()` as normal. Delete every override in this file the next
 * time `database.types.ts` is regenerated against these migrations.
 */

export type MedicationLogStatus =
  | "taken"
  | "missed"
  | "skipped"
  | "unable_to_obtain"
  | "vomited"
  | "side_effect"
  | "other";

export type MedicationAccessBarrierReason = "cost" | "stockout" | "distance" | "no_transport" | "other";

export type MedicationReviewEffectiveness =
  | "effective"
  | "partially_effective"
  | "not_effective"
  | "too_early_to_tell";

export type MedicationSideEffectSeverity = "mild" | "moderate" | "severe";
export type MedicationSideEffectStatus = "new" | "reviewed" | "dismissed";
export type MedicationSafetyAlertTypeCode = "medication_safety" | "potential_interaction";

export interface MedicationSideEffectReportRow {
  id: string;
  organisation_id: string;
  patient_id: string;
  medication_id: string;
  symptom: string;
  onset_date: string | null;
  severity: MedicationSideEffectSeverity;
  duration_text: string | null;
  description: string | null;
  reported_at: string;
  reported_by: string | null;
  status: MedicationSideEffectStatus;
  reviewed_by: string | null;
  reviewed_at: string | null;
  review_notes: string | null;
  clinician_alert_id: string | null;
  created_at: string;
  updated_at: string;
}

interface PgError {
  message: string;
}

interface SelectChain extends PromiseLike<{ data: unknown[] | null; error: PgError | null }> {
  eq(column: string, value: unknown): SelectChain;
  order(column: string, opts?: { ascending?: boolean; nullsFirst?: boolean }): SelectChain;
}

interface UpdateFilterChain {
  eq(column: string, value: unknown): PromiseLike<{ error: PgError | null }>;
}

interface UntypedTable {
  select(columns: string): SelectChain;
  insert(values: Record<string, unknown>): PromiseLike<{ error: PgError | null }>;
  update(values: Record<string, unknown>): UpdateFilterChain;
}

/**
 * Views one table through the minimal, loose interface above — for a
 * genuinely new table (no entry in the generated Tables union at all) or an
 * insert/update call that needs to send a column the generated Insert/
 * Update type doesn't know about yet. Not a blanket loosening: only the
 * call site that actually needs a new column reaches for this: everything
 * else on the same page keeps using the fully-typed `createClient()`.
 */
export function writableTable(table: string): UntypedTable {
  const supabase = createClient() as unknown as {
    from(table: string): UntypedTable;
  };
  return supabase.from(table);
}

/** Same idea as writableTable(), for public.raise_medication_safety_alert —
 * a brand-new RPC the generated Functions map doesn't know about yet. */
export function callRpc<TReturn>(
  fn: string,
  args: Record<string, unknown>
): PromiseLike<{ data: TReturn | null; error: PgError | null }> {
  const supabase = createClient() as unknown as {
    rpc<T>(fn: string, args: Record<string, unknown>): PromiseLike<{ data: T | null; error: PgError | null }>;
  };
  return supabase.rpc<TReturn>(fn, args);
}
