import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import type { Database } from "@tarragon/shared";
import { isCohortSuppressed } from "@/lib/institutions/suppression";
import { CARE_GAP_TYPES, type CareGapType as EngineGapType } from "@/lib/care-gaps/gap-model";

export type CareGapType = "overdue_screening" | "stale_monitoring" | "unactioned_abnormal";

/**
 * One cell of the institution ledger grid: a count of PEOPLE, or withheld. A withheld cell has no number at all (`n` is null), never a rounded or a
 * range value, so there is nothing to subtract.
 */
export type LedgerCell = { key: EngineGapType; n: number | null; suppressed: boolean };
export type LedgerReasonCell = { key: "closed" | "declined" | "unreachable" | "wrong"; n: number | null; suppressed: boolean };

/**
 * Counts from the real care gap ledger (S90), or "not live". `live: false` means the rules are not signed and switched on, so there is nothing to show
 * (the page says so). A `live: true` ledger is whatever the database published through the single minimum-cell rule, re-checked here.
 */
export type CareGapLedger =
  | { live: false }
  | {
      live: true;
      minCell: number;
      open: { byType: LedgerCell[]; anyPeople: number | null };
      closed90d: { byType: LedgerCell[]; anyPeople: number | null; byReason: LedgerReasonCell[] };
    };

/**
 * Counts only. There is deliberately no per-member row type here.
 *
 * Until 2026-07-29 this returned a `rows: CareGapRow[]` carrying each member's
 * patient number, gap type and condition, which the employer/HMO dashboard
 * rendered as an expandable list — so an employer could read "PT-000123 ·
 * Unactioned abnormal result — diabetes". I9 forbids an institution reaching
 * an individual, and the row type is removed rather than merely unrendered so
 * the drill-down cannot be reinstated by uncommenting a component.
 *
 * S90: the old `closedLast90Days` figure was an approximation (derived gaps keep no
 * history, so it counted "was due in the window and is done now"). It is gone. Closed counts now come only from the
 * care gap ledger, where a closure is a recorded row with the outcome that closed it, and only for the gap types that ledger holds.
 */
export type CareGapSummary = {
  totalOpen: number;
  byType: Record<CareGapType, number>;
  /** Denominator for the suppression decision, never the members themselves. */
  cohortSize: number;
  /** The ledger-backed counts (null when the read failed; `{ live: false }` before the rules are live). */
  ledger: CareGapLedger | null;
};

const cellSchema = z.object({ key: z.string(), n: z.number().int().nonnegative().nullable(), suppressed: z.boolean() });
const anySchema = z.number().int().nonnegative().nullable().optional();
const liveSchema = z.object({
  live: z.literal(true),
  min_cell: z.number().int().min(1),
  open: z.object({ by_type: z.array(cellSchema), any_people: anySchema }),
  closed_90d: z.object({ by_type: z.array(cellSchema), any_people: anySchema, by_reason: z.array(cellSchema) }),
});
const notLiveSchema = z.object({ live: z.literal(false) });

const REASONS = ["closed", "declined", "unreachable", "wrong"] as const;

/**
 * Second line of defence behind the database rule. A cell is shown only when it is zero or at least the minimum; a cell that arrives with a small positive
 * number, or that claims to be suppressed but still carries one, is withheld here. If any cell of a grid is withheld its total is withheld too, because the
 * types overlap and a total beside a withheld cell is a way back to it.
 */
function cleanCell<K extends string>(cell: z.infer<typeof cellSchema>, floor: number, keys: readonly K[]): { key: K; n: number | null; suppressed: boolean } | null {
  const key = keys.find((k) => k === cell.key);
  if (!key) return null;
  const small = cell.n !== null && cell.n > 0 && cell.n < floor;
  const withheld = cell.suppressed || cell.n === null || small;
  return { key, n: withheld ? null : cell.n, suppressed: withheld };
}

function cleanGrid<K extends string>(cells: z.infer<typeof cellSchema>[], floor: number, keys: readonly K[]) {
  const out = cells.map((c) => cleanCell(c, floor, keys)).filter((c): c is NonNullable<typeof c> => c !== null);
  // a small cell withholds a second one, so the withheld count cannot be recovered by subtraction
  const shownPositive = out.filter((c) => !c.suppressed && (c.n ?? 0) > 0).sort((a, b) => (a.n ?? 0) - (b.n ?? 0));
  const withheld = out.filter((c) => c.suppressed).length;
  if (withheld === 1 && shownPositive[0]) {
    const next = out.find((c) => c.key === shownPositive[0]?.key);
    if (next) {
      next.n = null;
      next.suppressed = true;
    }
  }
  return out;
}

export function parseCareGapLedger(raw: unknown): CareGapLedger | null {
  const notLive = notLiveSchema.safeParse(raw);
  if (notLive.success) return { live: false };
  const parsed = liveSchema.safeParse(raw);
  if (!parsed.success) return null;
  const floor = parsed.data.min_cell;
  const open = cleanGrid(parsed.data.open.by_type, floor, CARE_GAP_TYPES);
  const closed = cleanGrid(parsed.data.closed_90d.by_type, floor, CARE_GAP_TYPES);
  const reasons = cleanGrid(parsed.data.closed_90d.by_reason, floor, REASONS);
  const totalOk = (total: number | null | undefined, grids: { suppressed: boolean }[][]) =>
    typeof total === "number" && !grids.some((g) => g.some((c) => c.suppressed)) && total >= floor ? total : null;
  return {
    live: true,
    minCell: floor,
    open: { byType: open, anyPeople: totalOk(parsed.data.open.any_people, [open]) },
    closed90d: { byType: closed, anyPeople: totalOk(parsed.data.closed_90d.any_people, [closed, reasons]), byReason: reasons },
  };
}

/**
 * A filter by gap type only SELECTS cells that are already published. It never recomputes a figure, and it leaves the totals alone (they were decided on the
 * whole grid), so two different filters can never be subtracted to reveal a withheld cell.
 */
export function selectLedgerTypes(ledger: Extract<CareGapLedger, { live: true }>, types: readonly EngineGapType[]): Extract<CareGapLedger, { live: true }> {
  const keep = (cells: LedgerCell[]) => cells.filter((c) => types.includes(c.key));
  return { ...ledger, open: { ...ledger.open, byType: keep(ledger.open.byType) }, closed90d: { ...ledger.closed90d, byType: keep(ledger.closed90d.byType) } };
}

/**
 * Queries the security_invoker patient_care_gaps view, scoped by
 * organisation_id — RLS on the underlying tables (screening_schedules,
 * care_plans, screening_results, patient_risk_scores) does the actual
 * access control, this is just a convenience org filter on top.
 *
 * The ledger counts come from public.care_gap_institution_summary (service role only; the caller is this I9 doorway's client), which counts distinct people,
 * leaves out test accounts and shadow gaps, and applies the single minimum-cell rule with complementary suppression in the database.
 */
export async function loadCareGaps(
  supabase: SupabaseClient<Database>,
  organisationId: string,
  minCohortSize: number
): Promise<CareGapSummary | null> {
  const { data: patients } = await supabase
    .from("profiles")
    .select("id")
    .eq("organisation_id", organisationId)
    .eq("role", "patient");
  if (!patients || patients.length === 0) return null;
  // I9 small-cell suppression — a gap count over a handful of people names
  // them by implication. Same gate as loadCohortAnalytics.
  if (isCohortSuppressed(patients.length, minCohortSize)) return null;

  const patientIds = patients.map((p) => p.id);

  const { data: openGaps, error } = await supabase
    .from("patient_care_gaps")
    .select("gap_type, patient_id, opened_at")
    .in("patient_id", patientIds);
  if (error) throw error;

  const byType: Record<CareGapType, number> = {
    overdue_screening: 0,
    stale_monitoring: 0,
    unactioned_abnormal: 0,
  };
  let totalOpen = 0;
  for (const row of openGaps ?? []) {
    if (!row.gap_type || !row.patient_id || !row.opened_at) continue;
    const gapType = row.gap_type as CareGapType;
    if (!(gapType in byType)) continue;
    byType[gapType] += 1;
    totalOpen += 1;
  }

  // A failed ledger read is shown as "not available", never as zero.
  const { data: ledgerRaw, error: ledgerError } = await supabase.rpc("care_gap_institution_summary", { p_org: organisationId });
  const ledger = ledgerError ? null : parseCareGapLedger(ledgerRaw);

  return { totalOpen, byType, cohortSize: patients.length, ledger };
}
