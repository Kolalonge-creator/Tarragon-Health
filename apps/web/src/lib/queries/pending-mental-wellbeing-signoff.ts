import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@tarragon/shared";
import { guardListSchema } from "@/lib/go-live/model";
import type { RpcClient } from "@/lib/go-live/load";
import { newestWaiting } from "@/lib/queries/pending-quality-config-signoff";
import { pendingAttestations, worklistRulesView, type AttestationSlot, type WorklistRulesView } from "@/lib/clinical/mental-wellbeing-signoff-model";

export type PendingMentalWellbeingSignoff = {
  /** An unsigned, inactive mental_health_worklist_config version newer than the one in force. */
  worklistVersion: number | null;
  worklistRules: WorklistRulesView | null;
  /** The conditions a person must still record before the CMO may switch the guards on. */
  attestations: AttestationSlot[];
  /** The read failed: never render this as an all-clear. */
  failed: boolean;
};

type Row = { version: number; is_active: boolean; approved_at: string | null; rules?: unknown };
type Loose = { from(table: string): { select(columns: string): PromiseLike<{ data: Row[] | null; error: unknown }> } };

const FAILED: PendingMentalWellbeingSignoff = { worklistVersion: null, worklistRules: null, attestations: [], failed: true };

/**
 * What the S56b wellbeing features need from the Chief Medical Officer, for the sign-off hub. Nothing signs, attests or switches anything by
 * itself. Never throws; a failed read says so and is never an all-clear.
 */
export async function readPendingMentalWellbeingSignoff(supabase: SupabaseClient<Database>): Promise<PendingMentalWellbeingSignoff> {
  try {
    const [cfg, guards] = await Promise.all([
      (supabase as unknown as Loose).from("mental_health_worklist_config").select("version, is_active, approved_at, rules"),
      (supabase as unknown as RpcClient).rpc("go_live_guard_status"),
    ]);
    if (cfg.error || !cfg.data || guards.error) return FAILED;
    const parsed = guardListSchema.safeParse(guards.data);
    if (!parsed.success) return FAILED;
    const version = newestWaiting(cfg.data);
    return {
      worklistVersion: version,
      worklistRules: version === null ? null : worklistRulesView(cfg.data.find((r) => r.version === version)?.rules),
      attestations: pendingAttestations(parsed.data),
      failed: false,
    };
  } catch {
    return FAILED;
  }
}
