import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@tarragon/shared";

/** One rule as the panel shows it, read from the version being signed so the words and the values cannot differ. */
export type LabTrendRuleView = {
  analyte: string;
  unit: string;
  change: { kind: "rise" | "rise_pct" | "fall"; amount: number };
  latestAtLeast: number | null;
  note: string | null;
};

export type LabTrendRulesView = {
  windowMonths: number;
  minPoints: number;
  consecutive: boolean;
  rules: LabTrendRuleView[];
  persistent: { minPoints: number; analytes: string[] } | null;
  review: { alertLevel: string; slaPathway: string; slaTier: string };
};

export type LabTrendLastRun = { ranAt: string; outcome: "awaiting_signature" | "ok" | "failed"; alertsRaised: number; error: string | null };

export type PendingLabTrendRulesSignoff = {
  /** An unsigned version newer than the one in force, waiting for the CMO. */
  version: number | null;
  view: LabTrendRulesView | null;
  /** Why the database would refuse this version today (for example no active SLA for the named pathway); null when it can be signed. */
  problem: string | null;
  /** The review window the alert will carry, read from the active escalation_slas row; null when that row is missing. */
  slaMinutes: number | null;
  liveVersion: number | null;
  lastRun: LabTrendLastRun | null;
  /** The read failed: never render this as an all-clear. */
  failed: boolean;
};

const FAILED: PendingLabTrendRulesSignoff = { version: null, view: null, problem: null, slaMinutes: null, liveVersion: null, lastRun: null, failed: true };
const isObj = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const int = (v: unknown): number | null => (typeof v === "number" && Number.isInteger(v) ? v : null);
const num = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);
const str = (v: unknown): string | null => (typeof v === "string" && v.trim() !== "" ? v : null);

/** Pure: the panel view from a version's config, or null when something the panel must show is missing (it then refuses to offer Sign). */
export function labTrendRulesView(config: unknown): LabTrendRulesView | null {
  if (!isObj(config) || !Array.isArray(config.rules) || !isObj(config.review)) return null;
  const windowMonths = int(config.window_months), minPoints = int(config.min_points);
  if (windowMonths === null || minPoints === null || typeof config.consecutive_rise_required !== "boolean") return null;
  const rules: LabTrendRuleView[] = [];
  for (const r of config.rules) {
    if (!isObj(r)) return null;
    const analyte = str(r.analyte), unit = str(r.unit);
    if (!analyte || !unit) return null;
    const kinds = [
      ["rise", num(r.rise_from_first)],
      ["rise_pct", num(r.rise_pct_from_first)],
      ["fall", num(r.fall_from_first)],
    ].filter(([, v]) => v !== null) as ["rise" | "rise_pct" | "fall", number][];
    if (kinds.length !== 1) return null;
    const [kind, amount] = kinds[0]!;
    rules.push({ analyte, unit, change: { kind, amount }, latestAtLeast: num(r.latest_at_least), note: str(r.note) });
  }
  let persistent: LabTrendRulesView["persistent"] = null;
  if (config.persistent_out_of_range !== undefined) {
    const p = config.persistent_out_of_range;
    if (!isObj(p) || int(p.min_points) === null || !Array.isArray(p.analytes) || !p.analytes.every((a) => typeof a === "string")) return null;
    persistent = { minPoints: int(p.min_points)!, analytes: p.analytes as string[] };
  }
  const alertLevel = str(config.review.alert_level), slaPathway = str(config.review.sla_pathway), slaTier = str(config.review.sla_tier);
  if (!alertLevel || !slaPathway || !slaTier) return null;
  return { windowMonths, minPoints, consecutive: config.consecutive_rise_required, rules, persistent, review: { alertLevel, slaPathway, slaTier } };
}

function lastRun(v: unknown): LabTrendLastRun | null {
  if (!isObj(v)) return null;
  const outcome = v.outcome;
  if (outcome !== "awaiting_signature" && outcome !== "ok" && outcome !== "failed") return null;
  const ranAt = str(v.ran_at);
  if (!ranAt) return null;
  return { ranAt, outcome, alertsRaised: int(v.alerts_raised) ?? 0, error: str(v.error) };
}

/**
 * What the lab trend rules (T2 Phase 2) need from the Chief Medical Officer, for the sign-off hub. Read through
 * public.lab_trend_rules_for_signoff(), the only read path (the table is closed to every user role). Never throws.
 */
export async function readPendingLabTrendRulesSignoff(supabase: SupabaseClient<Database>): Promise<PendingLabTrendRulesSignoff> {
  try {
    const { data, error } = await supabase.rpc("lab_trend_rules_for_signoff");
    if (error || !isObj(data)) return FAILED;
    const live = isObj(data.live) ? int(data.live.version) : null;
    const pending = isObj(data.pending) ? data.pending : null;
    const version = pending ? int(pending.version) : null;
    return {
      version,
      view: pending && version !== null ? labTrendRulesView(pending.config) : null,
      problem: pending ? str(pending.problem) : null,
      slaMinutes: pending ? int(pending.sla_minutes) : null,
      liveVersion: live,
      lastRun: lastRun(data.last_run),
      failed: false,
    };
  } catch {
    return FAILED;
  }
}
