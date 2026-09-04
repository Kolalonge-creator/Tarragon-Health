/**
 * The shape of a frozen board-report snapshot, and the small amount of
 * formatting the document needs.
 *
 * Everything here is READ-ONLY over a snapshot that was computed in the
 * database and can never change afterwards (see
 * 20260902211636_payer_board_outcomes_report.sql). Nothing in this file
 * computes, rounds, infers or fills in a figure — if a number is not in the
 * snapshot, the document says so rather than deriving one. That is the whole
 * point: a reader must be able to trust that the rendered page and the
 * hashed record are the same numbers.
 */

export type MeasureDomain = "clinical_outcome" | "process" | "service" | "financial";

export type BoardMeasure = {
  code: string;
  spec_version: number;
  title: string;
  domain: MeasureDomain;
  unit: string;
  direction: "higher_is_better" | "lower_is_better";
  definitions: {
    rationale: string;
    numerator: string;
    denominator: string;
    exclusions: string;
    limitations: string;
    data_sources: string[];
  };
  suppression_floor: number;
  reportable: boolean;
  not_reportable_reason: string | null;
  /** Null whenever `reportable` is false — never zero. */
  denominator: number | null;
  measurable: number | null;
  numerator: number | null;
  unmeasurable: number | null;
  unmeasurable_reason: string | null;
  rate_pct: number | null;
  data_completeness_pct: number | null;
};

export type BoardReportSnapshot = {
  report: {
    number: string;
    insurer_name: string;
    insurer_code: string | null;
    period_start: string;
    period_end: string;
    generated_at: string;
    generated_by_name: string | null;
    engine_version: string;
  };
  cohort: {
    covered_any_time: number;
    continuously_covered: number;
    joined_during_period: number;
    left_during_period: number;
    suppression_floor: number;
    definition: string;
  };
  measures: BoardMeasure[];
  financial:
    | { reportable: false; not_reportable_reason: string }
    | {
        reportable: true;
        claims_submitted: number;
        claims_paid: number;
        claims_denied: number;
        claims_open: number;
        billed_kobo: number;
        insurer_covered_kobo: number;
        member_copay_kobo: number;
      };
  limitations: string[];
  lineage: {
    source_tables: string[];
    computed_at: string;
    timezone: string;
    engine_version: string;
    measure_definitions_in_force_on: string;
    note: string;
  };
};

export type BoardReportRow = {
  id: string;
  report_number: string;
  period_start: string;
  period_end: string;
  status: "draft" | "attested" | "superseded" | "withdrawn";
  content_hash: string;
  generated_at: string;
  attested_at: string | null;
  attestation_statement: string | null;
  attester_role_title: string | null;
  withdrawal_reason: string | null;
  snapshot: BoardReportSnapshot;
};

export const STATUS_LABEL: Record<BoardReportRow["status"], string> = {
  draft: "Draft — not attested",
  attested: "Attested",
  superseded: "Superseded",
  withdrawn: "Withdrawn",
};

/** Dashboard status palette (green/amber/red/grey), which the brand guide
 * keeps deliberately separate from the brand colours. */
export const STATUS_TONE: Record<BoardReportRow["status"], string> = {
  draft: "bg-amber-100 text-amber-900",
  attested: "bg-green-100 text-green-900",
  superseded: "bg-slate-100 text-slate-700",
  withdrawn: "bg-red-100 text-red-900",
};

export const DOMAIN_LABEL: Record<MeasureDomain, string> = {
  clinical_outcome: "Clinical outcome",
  process: "Care process",
  service: "Service level",
  financial: "Financial",
};

export function formatPeriod(start: string, end: string): string {
  const fmt = (d: string) =>
    new Date(d + "T00:00:00Z").toLocaleDateString("en-GB", {
      day: "numeric",
      month: "short",
      year: "numeric",
      timeZone: "UTC",
    });
  return `${fmt(start)} to ${fmt(end)}`;
}

export function formatDateTime(iso: string): string {
  return new Date(iso).toLocaleString("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "Africa/Lagos",
  });
}

/** Kobo is the stored unit for every naira amount on this platform. */
export function formatNaira(kobo: number): string {
  return new Intl.NumberFormat("en-NG", {
    style: "currency",
    currency: "NGN",
    maximumFractionDigits: 0,
  }).format(kobo / 100);
}

/** Groups the hash into readable blocks so somebody can compare a printed
 * copy against a screen character by character without losing their place. */
export function formatHashForPrint(hash: string): string {
  return (hash.match(/.{1,8}/g) ?? []).join(" ");
}
