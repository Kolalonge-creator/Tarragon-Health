import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@tarragon/shared";
import { newestWaiting } from "@/lib/queries/pending-quality-config-signoff";
import { baselineRulesView, type BaselineRulesView } from "@/lib/clinical/baseline-labs-view";

export type PendingBaselineLabsSignoff = {
  /** An unsigned, inactive baseline_labs_config version newer than the one in force. */
  version: number | null;
  rules: BaselineRulesView | null;
  /** The read failed: never render this as an all-clear. */
  failed: boolean;
};

type Row = { version: number; is_active: boolean; approved_at: string | null; config?: unknown };
type Loose = { from(table: string): { select(columns: string): PromiseLike<{ data: Row[] | null; error: unknown }> } };

const FAILED: PendingBaselineLabsSignoff = { version: null, rules: null, failed: true };

/**
 * What the baseline labs prescribing rule needs from the Chief Medical Officer, for the sign-off hub. Nothing signs by itself: the draft stays
 * inactive, and the check adds no finding anywhere, until the CMO presses the sign control. Never throws.
 */
export async function readPendingBaselineLabsSignoff(supabase: SupabaseClient<Database>): Promise<PendingBaselineLabsSignoff> {
  try {
    const res = await (supabase as unknown as Loose).from("baseline_labs_config").select("version, is_active, approved_at, config");
    if (res.error || !res.data) return FAILED;
    const version = newestWaiting(res.data);
    return { version, rules: version === null ? null : baselineRulesView(res.data.find((r) => r.version === version)?.config), failed: false };
  } catch {
    return FAILED;
  }
}
