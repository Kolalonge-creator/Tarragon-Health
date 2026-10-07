/**
 * Yearly Tarragon Health Report (S46, function 3.15): the shapes the collector (SQL) hands in and the composer hands back.
 * Design rules come from docs/research/health-report-study.md. The composer makes no clinical decision of its own: every range comes from the
 * laboratory, the care team or the signed (or PROPOSED) report settings.
 */

export interface HealthReportConfig {
  readonly maxPriorities: number;
  readonly minBpReadings: number;
  readonly bpTarget: { readonly systolicBelow: number; readonly diastolicBelow: number };
  readonly bpBorderlineMarginMmHg: number;
  readonly labBorderlineMarginPct: number;
  readonly changeTolerancePct: number;
  readonly recheckWeeks: number;
  readonly priorityWindows: { readonly bp: string; readonly lab: string; readonly screening: string; readonly risk: string };
  readonly trendMinPoints: number;
  readonly trendYears: number;
  readonly statementKey: string;
  readonly statementApprovedByCmo: boolean;
  readonly shareExcludedSections: readonly string[];
}

export interface LabPoint {
  readonly at: string;
  readonly value: number;
  readonly refLow: number | null;
  readonly refHigh: number | null;
  readonly flag: string | null;
  readonly unit: string | null;
}

export interface HealthReportFacts {
  readonly year: number;
  readonly bp: { readonly count: number; readonly firstAt: string | null; readonly lastAt: string | null; readonly avgSystolic: number | null; readonly avgDiastolic: number | null };
  readonly bpPrior: { readonly count: number; readonly avgSystolic: number | null; readonly avgDiastolic: number | null } | null;
  readonly bpCareTeamTarget: { readonly systolicBelow: number; readonly diastolicBelow: number; readonly setBy: string } | null;
  readonly weight: { readonly latestKg: number | null; readonly latestAt: string | null; readonly count: number } | null;
  readonly devices: { readonly manual: number; readonly device: number; readonly wearable: number };
  readonly labs: readonly { readonly code: string; readonly unit: string | null; readonly readingsThisYear: number; readonly latest: LabPoint | null; readonly previous: LabPoint | null }[];
  readonly trends: readonly { readonly code: string; readonly unitMixed: boolean; readonly points: readonly { readonly at: string; readonly value: number; readonly unit: string | null; readonly refLow: number | null; readonly refHigh: number | null }[] }[];
  readonly screening: {
    readonly done: readonly { readonly code: string; readonly on: string; readonly reproductive: boolean }[];
    readonly due: readonly { readonly code: string; readonly dueOn: string; readonly status: string; readonly reproductive: boolean }[];
  };
  readonly risk:
    | { readonly state: "not_assessed" }
    | { readonly state: "assessed"; readonly bandCode: string; readonly tier: string; readonly lowPct: number | null; readonly highPct: number | null; readonly model: string; readonly assessedAt: string; readonly basedOn: Record<string, unknown> };
  readonly questionnaires: readonly { readonly type: string; readonly level: string | null; readonly at: string }[];
}

/** Three states plus "not measured" (principle 3). "no_target" is an honest extra: a value was recorded but nobody supplied a range for it. */
export type ReportState = "on_target" | "needs_attention" | "not_checked" | "not_measured" | "no_target";
export type ReportChange = "improved" | "same" | "worse" | "no_comparison";

export interface ReportItem {
  readonly id: string;
  readonly kind: "bp" | "lab" | "screening";
  readonly code: string;
  readonly state: ReportState;
  readonly value: number | null;
  readonly value2: number | null;
  readonly unit: string | null;
  readonly readingCount: number;
  readonly tooFewReadings: boolean;
  readonly minReadings: number | null;
  readonly borderline: boolean;
  readonly recheckWeeks: number | null;
  readonly target: { readonly low: number | null; readonly high: number | null; readonly high2: number | null; readonly source: "lab_reference" | "care_team" | "report_settings" } | null;
  readonly change: ReportChange;
  readonly previousValue: number | null;
  readonly dateFrom: string | null;
  readonly dateTo: string | null;
  readonly reason: string | null;
  /** Percent outside the range (labs) or mmHg above the target (BP); 0 when inside. Used only to rank priorities. */
  readonly excess: number;
}

export interface ReportPriority {
  readonly id: string;
  readonly category: "bp" | "lab" | "screening" | "risk";
  /** i18n keys, except `when`, which is the settings' own window text. */
  readonly action: string;
  readonly why: string;
  readonly whoHelps: string;
  readonly when: string;
  readonly params: Readonly<Record<string, string | number>>;
}

export interface ComposedReport {
  readonly schema: 1;
  readonly year: number;
  readonly items: readonly ReportItem[];
  readonly priorities: readonly ReportPriority[];
  readonly alsoWorthKnowing: readonly ReportPriority[];
  readonly summary: { readonly key: string; readonly params: Readonly<Record<string, number>> };
  readonly risk: HealthReportFacts["risk"];
  readonly screening: HealthReportFacts["screening"];
  readonly trends: HealthReportFacts["trends"];
  readonly questionnaires: HealthReportFacts["questionnaires"];
  readonly devices: HealthReportFacts["devices"];
  readonly weight: HealthReportFacts["weight"];
  readonly statementKey: string;
  readonly statementApprovedByCmo: boolean;
  readonly minBpReadings: number;
}
