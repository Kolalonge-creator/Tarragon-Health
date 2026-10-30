import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@tarragon/shared";
import { newestWaiting } from "@/lib/queries/pending-quality-config-signoff";

/**
 * What the care gap rule configuration (S90) needs from the Chief Medical Officer, for the sign-off hub. Everything shown is read from the draft being
 * signed, so the numbers the CMO reads are the numbers the engine will use. A value left null in the draft is shown as "not supplied" and the rule it
 * belongs to is said to be inert: the engine invents no clinical number.
 */
export type CareGapRuleLine = {
  code: string;
  title: string;
  owner: "doctor" | "coordinator";
  enabled: boolean;
  /** Plain statements of the lines this rule uses ("14 days without a reading"). */
  lines: string[];
  /** Fields the draft leaves for the CMO to supply; while any is missing the rule does nothing. */
  notSupplied: string[];
  source: string;
};

export type CareGapRulesView = {
  rules: CareGapRuleLine[];
  ladder: string[];
  experiments: string;
  verifyAgainstSource: boolean;
};

export type PendingCareGapConfigSignoff = {
  /** An unsigned, inactive care_gap_rule_config version newer than the one in force. */
  version: number | null;
  rules: CareGapRulesView | null;
  /** The read failed: never render this as an all-clear. */
  failed: boolean;
};

type Row = { version: number; is_active: boolean; approved_at: string | null; config?: unknown };
type Loose = { from(table: string): { select(columns: string): PromiseLike<{ data: Row[] | null; error: unknown }> } };

const FAILED: PendingCareGapConfigSignoff = { version: null, rules: null, failed: true };
const isObj = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const num = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);
const str = (v: unknown): string | null => (typeof v === "string" ? v : null);

const TITLES: Record<string, string> = {
  missed_reading: "Missed reading",
  no_hba1c_12_months: "No HbA1c in 12 months",
  no_lipids_12_months: "No lipids in 12 months",
  rising_bp_trend: "Rising blood pressure trend",
  medication_refill_lapse: "Refill overdue",
  adherence_lapse: "Adherence below the line",
};
const ORDER = ["missed_reading", "no_hba1c_12_months", "no_lipids_12_months", "rising_bp_trend", "medication_refill_lapse", "adherence_lapse"] as const;

function ruleLines(code: string, r: Record<string, unknown>): { lines: string[]; missing: string[] } {
  const lines: string[] = [];
  const missing: string[] = [];
  const need = (field: string, text: (n: number) => string) => {
    const n = num(r[field]);
    if (n === null) missing.push(field);
    else lines.push(text(n));
  };
  if (code === "missed_reading") {
    need("hypertension_days_without_reading", (n) => `Hypertension: no home blood pressure reading in ${n} days`);
    need("diabetes_days_without_reading", (n) => `Diabetes: no home glucose reading in ${n} days`);
  } else if (code === "no_hba1c_12_months" || code === "no_lipids_12_months") {
    need("lookback_days", (n) => `No matching lab result in the last ${n} days`);
    need("grace_days", (n) => `Counted overdue ${n} days after it falls due`);
    const codes = Array.isArray(r.analyte_codes) ? r.analyte_codes.filter((c): c is string => typeof c === "string") : [];
    if (codes.length) lines.push(`Lab codes read: ${codes.join(", ")}`);
  } else if (code === "rising_bp_trend") {
    need("window_days", (n) => `Compares the average of the last ${n} days with the ${n} days before`);
    need("min_readings_per_window", (n) => `At least ${n} usable readings in each window`);
    need("min_rise_systolic_mmhg", (n) => `A rise in the systolic average of at least ${n} mmHg`);
  } else if (code === "medication_refill_lapse") {
    need("days_past_due", (n) => `Refill date passed by ${n} days`);
  } else if (code === "adherence_lapse") {
    const ev = str(r.signal_event);
    if (ev === null) missing.push("signal_event");
    else lines.push(`Reads the existing ${ev} signal`);
    need("within_days", (n) => `Signal seen in the last ${n} days`);
  }
  return { lines, missing };
}

/** Pure: the panel view from a draft's config, or null when something it must show is missing (the panel then says nothing rather than guess). */
export function careGapRulesView(config: unknown): CareGapRulesView | null {
  if (!isObj(config) || !isObj(config.rules) || !isObj(config.ladder) || !isObj(config.ab)) return null;
  const rules: CareGapRuleLine[] = [];
  for (const code of ORDER) {
    const r = config.rules[code];
    if (!isObj(r)) return null;
    const { lines, missing } = ruleLines(code, r);
    const owner = r.owner_role === "clinician" ? "doctor" : "coordinator";
    const src = str(r.source);
    if (src === null) return null;
    rules.push({ code, title: TITLES[code] ?? code, owner, enabled: r.enabled === true, lines, notSupplied: missing, source: src });
  }
  const l = config.ladder;
  const steps = Array.isArray(l.steps) ? l.steps.filter((s): s is string => typeof s === "string") : [];
  const cap = num(l.weekly_cap_per_patient);
  const gap = num(l.days_between_steps);
  const qh = isObj(l.quiet_hours) ? l.quiet_hours : null;
  if (steps.length === 0 || cap === null || gap === null || !qh || !str(qh.start) || !str(qh.end)) return null;
  const ladder = [
    `Steps in order: ${steps.map((s) => s.replace(/_/g, " ")).join(", then ")}`,
    `${gap} days between steps`,
    `At most ${cap} messages a week to one patient, across all gaps`,
    `No message between ${str(qh.start)} and ${str(qh.end)} Lagos time`,
    "A staff call is never capped; a gap can be marked unreachable only after the logged staff attempts the rules require",
  ];
  const experiments = config.ab.enabled === true ? "Experiments are switched on in this draft." : "No experiment is switched on: every patient sees the same wording at the normal time.";
  return { rules, ladder, experiments, verifyAgainstSource: config.verify_against_source === true };
}

/**
 * Reads the draft the CMO still has to sign. Nothing signs by itself: the draft stays inactive until the CMO presses the sign control, and until then
 * the engine runs in shadow mode (staff see gaps, nobody is contacted). Never throws.
 */
export async function readPendingCareGapConfigSignoff(supabase: SupabaseClient<Database>): Promise<PendingCareGapConfigSignoff> {
  try {
    const res = await (supabase as unknown as Loose).from("care_gap_rule_config").select("version, is_active, approved_at, config");
    if (res.error || !res.data) return FAILED;
    const version = newestWaiting(res.data);
    return { version, rules: version === null ? null : careGapRulesView(res.data.find((r) => r.version === version)?.config), failed: false };
  } catch {
    return FAILED;
  }
}
