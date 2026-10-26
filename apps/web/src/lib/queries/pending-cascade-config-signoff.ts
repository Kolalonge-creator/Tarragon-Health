import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@tarragon/shared";
import { newestWaiting } from "@/lib/queries/pending-quality-config-signoff";

/** What the sign-off panel shows, read from the draft itself so the definitions the CMO signs are the ones that will apply. */
export type CascadeRulesView = {
  hypertension: { controlled: string; stages: { label: string; definition: string }[]; notAvailable: string[] };
  diabetes: { controlled: string; stages: { label: string; definition: string }[]; notAvailable: string[] };
  panelNote: string;
  differenceFromBpReports: string;
};

export type PendingCascadeConfigSignoff = {
  /** An unsigned, inactive outcome_cascade_config version newer than the one in force. */
  version: number | null;
  rules: CascadeRulesView | null;
  /** The read failed: never render this as an all-clear. */
  failed: boolean;
};

type Row = { version: number; is_active: boolean; approved_at: string | null; config?: unknown };
type Loose = { from(table: string): { select(columns: string): PromiseLike<{ data: Row[] | null; error: unknown }> } };

const FAILED: PendingCascadeConfigSignoff = { version: null, rules: null, failed: true };
const isObj = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

function condition(c: unknown, controlled: (c: Record<string, unknown>) => string | null): CascadeRulesView["hypertension"] | null {
  if (!isObj(c) || !Array.isArray(c.stages) || !Array.isArray(c.not_available)) return null;
  const ctl = controlled(c);
  if (ctl === null) return null;
  const stages: { label: string; definition: string }[] = [];
  for (const s of c.stages) {
    if (!isObj(s) || typeof s.label !== "string" || typeof s.definition !== "string") return null;
    stages.push({ label: s.label, definition: s.definition });
  }
  const notAvailable: string[] = [];
  for (const n of c.not_available) {
    if (!isObj(n) || typeof n.item !== "string" || typeof n.reason !== "string") return null;
    notAvailable.push(`${n.item}: ${n.reason}`);
  }
  return { controlled: ctl, stages, notAvailable };
}

/** Pure: the panel view from a draft's config, or null when something it must show is missing (the panel then says nothing rather than guess). */
export function cascadeRulesView(config: unknown): CascadeRulesView | null {
  if (!isObj(config) || !isObj(config.selection_panel) || !isObj(config.notes)) return null;
  const htn = condition(config.hypertension, (c) => {
    const b = c.controlled_below;
    return isObj(b) && typeof b.systolic === "number" && typeof b.diastolic === "number" && typeof c.control_window_days === "number" && typeof c.min_readings === "number"
      ? `the average of the cleared home readings in the last ${c.control_window_days} days up to the report day, from at least ${c.min_readings} readings, is under ${b.systolic}/${b.diastolic}`
      : null;
  });
  const dm = condition(config.diabetes, (c) => (typeof c.controlled_hba1c_below_percent === "number" && typeof c.lookback_days === "number" ? `the most recent HbA1c in the last ${c.lookback_days} days is under ${c.controlled_hba1c_below_percent} percent` : null));
  const note = config.selection_panel.note;
  const diff = config.notes.difference_from_s38;
  if (!htn || !dm || typeof note !== "string" || typeof diff !== "string") return null;
  return { hypertension: htn, diabetes: dm, panelNote: note, differenceFromBpReports: diff };
}

/**
 * What the cascade-of-care definitions need from the Chief Medical Officer, for the sign-off hub. Nothing signs by itself: the draft stays inactive
 * until the CMO presses the sign control, and nothing is counted on screen, in a file or in a sponsor pack before then. Never throws.
 */
export async function readPendingCascadeConfigSignoff(supabase: SupabaseClient<Database>): Promise<PendingCascadeConfigSignoff> {
  try {
    const res = await (supabase as unknown as Loose).from("outcome_cascade_config").select("version, is_active, approved_at, config");
    if (res.error || !res.data) return FAILED;
    const version = newestWaiting(res.data);
    return { version, rules: version === null ? null : cascadeRulesView(res.data.find((r) => r.version === version)?.config), failed: false };
  } catch {
    return FAILED;
  }
}
