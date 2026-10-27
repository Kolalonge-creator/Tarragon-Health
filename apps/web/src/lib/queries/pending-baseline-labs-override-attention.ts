import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@tarragon/shared";
import type { SignoffQueueItem } from "@/lib/queries/signoff-queue";

export type BaselineLabsOverrideAttention = {
  /** Used overrides whose baseline labs are still outstanding after the follow-up time. */
  overdue: number;
  /** Overrides used in the last 30 days. */
  used30d: number;
  /** The read failed, so the counts understate reality: never render it as an all-clear. */
  failed: boolean;
};

export const BASELINE_LABS_OVERRIDE_ITEM_KEY = "baseline_labs_override_followup";

const FAILED: BaselineLabsOverrideAttention = { overdue: 0, used30d: 0, failed: true };
const num = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) && v >= 0 ? v : null);

/**
 * Baseline-labs overrides whose labs have not arrived after 48 hours, for the CMO sign-off hub. This is attention, not a signature. Never throws; a
 * failed read says so instead of looking like nothing is outstanding.
 */
export async function readBaselineLabsOverrideAttention(supabase: SupabaseClient<Database>): Promise<BaselineLabsOverrideAttention> {
  try {
    const { data, error } = await (supabase as unknown as { rpc: (fn: string) => PromiseLike<{ data: unknown; error: unknown }> }).rpc("baseline_labs_override_attention");
    if (error || typeof data !== "object" || data === null) return FAILED;
    const d = data as Record<string, unknown>;
    const overdue = num(d.overdue);
    const used30d = num(d.used_30d);
    return overdue === null || used30d === null ? FAILED : { overdue, used30d, failed: false };
  } catch {
    return FAILED;
  }
}

/** The hub line, or null when no override is waiting for its labs. */
export function baselineLabsOverrideItem(a: BaselineLabsOverrideAttention): SignoffQueueItem | null {
  if (a.overdue === 0) return null;
  return {
    key: BASELINE_LABS_OVERRIDE_ITEM_KEY,
    title: "Baseline labs still missing after an override",
    detail: `${a.overdue} medicine${a.overdue === 1 ? " was" : "s were"} started or raised under a documented override and the baseline labs have not arrived after 48 hours (${a.used30d} override${a.used30d === 1 ? "" : "s"} used in the last 30 days). Each one is on the patient's lab monitoring list.`,
    href: "/clinician/clinical-signoff",
    severity: "draft_pending",
    count: a.overdue,
  };
}
