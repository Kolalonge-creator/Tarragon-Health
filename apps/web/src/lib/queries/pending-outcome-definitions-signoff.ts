import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@tarragon/shared";
import { newestWaiting } from "@/lib/queries/pending-quality-config-signoff";

/**
 * What the two outcome definitions (D4 reliable change for PHQ-9 and GAD-7, D3 what counts as a doctor adjusting a hypertension medicine) need from the
 * Chief Medical Officer, for the sign-off hub. Each view is read from the draft itself, so the words and numbers the CMO signs are the ones that will
 * apply. Nothing signs by itself: a draft stays inactive until the CMO presses the sign control, and nothing is counted anywhere before then.
 */
export type ReliableChangeView = { phq9Points: number; gad7Points: number; source: string; note: string };
export type AdjustmentView = { windowDays: number; signals: string[]; groups: string[]; limitations: string; note: string };

export type PendingOutcomeDefinitionsSignoff = {
  reliableChange: { version: number | null; view: ReliableChangeView | null };
  adjustment: { version: number | null; view: AdjustmentView | null };
  /** The read failed: never render this as an all-clear. */
  failed: boolean;
};

type Row = { version: number; is_active: boolean; approved_at: string | null; config?: unknown };
type Loose = { from(table: string): { select(columns: string): PromiseLike<{ data: Row[] | null; error: unknown }> } };

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const FAILED: PendingOutcomeDefinitionsSignoff = { reliableChange: { version: null, view: null }, adjustment: { version: null, view: null }, failed: true };

/** Pure: the panel view from a draft's config, or null when something it must show is missing (the panel then says nothing rather than guess). */
export function reliableChangeView(config: unknown): ReliableChangeView | null {
  if (!isObj(config) || !isObj(config.instruments) || typeof config.source !== "string" || typeof config.note !== "string") return null;
  const one = (k: string): number | null => {
    const i = (config.instruments as Record<string, unknown>)[k];
    return isObj(i) && typeof i.reliable_change_points === "number" && Number.isInteger(i.reliable_change_points) && i.reliable_change_points >= 1 ? i.reliable_change_points : null;
  };
  const phq9 = one("phq9");
  const gad7 = one("gad7");
  return phq9 === null || gad7 === null ? null : { phq9Points: phq9, gad7Points: gad7, source: config.source, note: config.note };
}

export function adjustmentView(config: unknown): AdjustmentView | null {
  if (!isObj(config) || !isObj(config.signals) || !Array.isArray(config.groups)) return null;
  if (typeof config.adjustment_window_days !== "number" || typeof config.limitations !== "string" || typeof config.note !== "string") return null;
  const signals: string[] = [];
  for (const s of Object.values(config.signals)) {
    if (!isObj(s) || typeof s.definition !== "string") return null;
    if (s.enabled === true) signals.push(s.definition);
  }
  const groups: string[] = [];
  for (const g of config.groups) {
    if (!isObj(g) || typeof g.label !== "string" || typeof g.definition !== "string") return null;
    groups.push(`${g.label}. ${g.definition}`);
  }
  return { windowDays: config.adjustment_window_days, signals, groups, limitations: config.limitations, note: config.note };
}

/** Never throws. */
export async function readPendingOutcomeDefinitionsSignoff(supabase: SupabaseClient<Database>): Promise<PendingOutcomeDefinitionsSignoff> {
  try {
    const loose = supabase as unknown as Loose;
    const [rc, adj] = await Promise.all([
      loose.from("outcome_reliable_change_config").select("version, is_active, approved_at, config"),
      loose.from("outcome_adjustment_config").select("version, is_active, approved_at, config"),
    ]);
    if (rc.error || !rc.data || adj.error || !adj.data) return FAILED;
    const rcVersion = newestWaiting(rc.data);
    const adjVersion = newestWaiting(adj.data);
    return {
      reliableChange: { version: rcVersion, view: rcVersion === null ? null : reliableChangeView(rc.data.find((r) => r.version === rcVersion)?.config) },
      adjustment: { version: adjVersion, view: adjVersion === null ? null : adjustmentView(adj.data.find((r) => r.version === adjVersion)?.config) },
      failed: false,
    };
  } catch {
    return FAILED;
  }
}
