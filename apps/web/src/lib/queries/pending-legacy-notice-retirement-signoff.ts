import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@tarragon/shared";

/** The values of one version of legacy_notice_retirement_config (all whole numbers, hold_seconds in seconds). */
export type LegacyNoticeRules = {
  observe: number;
  suppress_legacy_bp_notice: number;
  suppress_legacy_glucose_notice: number;
  suppress_legacy_emergency_notice: number;
  circle_notice_unified_page: number;
  hold_seconds: number;
  emergency_hold_seconds: number;
  emergency_engine_fresh_seconds: number;
  min_parallel_days: number;
  min_parallel_events: number;
};

export type LegacyNoticeVersion = { version: number; rules: LegacyNoticeRules; description: string };

export type LegacyNoticeMeasurementRow = {
  kind: string;
  events: number;
  observed: number;
  held: number;
  suppressed: number;
  released: number;
  fired: number;
  page_seen: number;
  page_first: number;
  page_within_hold: number;
  primary_not_reachable: number;
  median_lag_seconds: number | null;
  p95_lag_seconds: number | null;
};

export type LegacyNoticeRetirementState = {
  /** The live version, or null when the retirement is OFF. */
  liveVersion: LegacyNoticeVersion | null;
  /** Every version that is not live, oldest first. The CMO chooses; nothing is picked for them. */
  waiting: LegacyNoticeVersion[];
  /** Real-patient events in the last 14 days, by pathway. Empty when nothing has been observed yet. */
  measurement: LegacyNoticeMeasurementRow[];
  /** The read failed: never render this as an all-clear and never as "off". */
  failed: boolean;
};

type Row = { version: number; is_active: boolean; rules: Partial<Record<keyof LegacyNoticeRules, unknown>> };
type Loose = {
  from(table: string): { select(columns: string): PromiseLike<{ data: Row[] | null; error: unknown }> };
  rpc(fn: string, args?: Record<string, unknown>): PromiseLike<{ data: unknown; error: unknown }>;
};

const KEYS: Array<keyof LegacyNoticeRules> = [
  "observe",
  "suppress_legacy_bp_notice",
  "suppress_legacy_glucose_notice",
  "suppress_legacy_emergency_notice",
  "circle_notice_unified_page",
  "hold_seconds",
  "emergency_hold_seconds",
  "emergency_engine_fresh_seconds",
  "min_parallel_days",
  "min_parallel_events",
];

/** Pure: a row's rules as whole numbers, or null when any value is missing or not a whole number (never guessed). */
export function parseLegacyNoticeRules(rules: Row["rules"]): LegacyNoticeRules | null {
  const out: Partial<LegacyNoticeRules> = {};
  for (const k of KEYS) {
    const v = rules[k];
    if (typeof v !== "number" || !Number.isInteger(v)) return null;
    out[k] = v;
  }
  return out as LegacyNoticeRules;
}

/** Pure: one plain description of what a version does, built from its own values so the words can never disagree with the settings. */
export function describeLegacyNoticeRules(r: LegacyNoticeRules): string {
  const retired: string[] = [];
  if (r.suppress_legacy_bp_notice === 1) retired.push("blood pressure red events");
  if (r.suppress_legacy_glucose_notice === 1) retired.push("glucose emergencies");
  const parts: string[] = [];
  if (retired.length > 0) {
    const emergency =
      r.suppress_legacy_emergency_notice === 1
        ? "Emergency-level events are included."
        : "Emergency-level events keep their notify-everyone message.";
    parts.push(
      `The notify-everyone message for ${retired.join(" and ")} is held for up to ${r.hold_seconds} seconds (${r.emergency_hold_seconds} for emergency-level events, and only while the event bus is alive) and dropped only once the on-call page for that same event exists and the paged clinician can be reached; otherwise it is sent. ${emergency} It can only be switched on after the parallel run has been on for ${r.min_parallel_days} days and measured ${r.min_parallel_events} real events.`,
    );
  } else if (r.observe === 1 && r.circle_notice_unified_page !== 1) {
    parts.push("Parallel run: nothing changes. Both messages are sent as today, and each event records whether and how quickly its page arrived.");
  }
  if (r.circle_notice_unified_page === 1) {
    parts.push(
      "A neutral check-in notice also goes to the patient's Care Circle members who allowed red alerts when the on-call page is one of the new unified pages. It is withheld for any symptom event when the patient has a pregnancy or reproductive-health record.",
    );
  }
  return parts.join(" ");
}

function toVersion(row: Row): LegacyNoticeVersion | null {
  const rules = parseLegacyNoticeRules(row.rules);
  return rules ? { version: row.version, rules, description: describeLegacyNoticeRules(rules) } : null;
}

/**
 * What the legacy notice retirement needs from the Chief Medical Officer, for the sign-off hub. Nothing switches on by itself. Never throws;
 * a failed read says so, and a version whose values cannot be read is not offered.
 */
export async function readLegacyNoticeRetirementState(supabase: SupabaseClient<Database>): Promise<LegacyNoticeRetirementState> {
  try {
    const loose = supabase as unknown as Loose;
    const { data, error } = await loose.from("legacy_notice_retirement_config").select("version, is_active, rules");
    if (error || !data) return { liveVersion: null, waiting: [], measurement: [], failed: true };
    const live = data.filter((r) => r.is_active).sort((a, b) => b.version - a.version)[0];
    const liveVersion = live ? toVersion(live) : null;
    // A live row whose values cannot be read must not look like "off".
    if (live && !liveVersion) return { liveVersion: null, waiting: [], measurement: [], failed: true };
    const waiting = data
      .filter((r) => !r.is_active)
      .sort((a, b) => a.version - b.version)
      .map(toVersion)
      .filter((v): v is LegacyNoticeVersion => v !== null);
    const m = await loose.rpc("legacy_notice_measurement", { p_days: 14, p_include_test: false });
    if (m.error) return { liveVersion, waiting, measurement: [], failed: true };
    const measurement = Array.isArray(m.data) ? (m.data as LegacyNoticeMeasurementRow[]) : [];
    return { liveVersion, waiting, measurement, failed: false };
  } catch {
    return { liveVersion: null, waiting: [], measurement: [], failed: true };
  }
}
