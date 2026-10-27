import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@tarragon/shared";
import { newestWaiting } from "@/lib/queries/pending-quality-config-signoff";

/** What the sign-off panel shows, read from the draft itself so the rules the CMO signs are the ones that will apply. */
export type AiMonitoringRulesView = {
  sampleRatePercent: number;
  alwaysSampled: string[];
  costSpikeFactor: number;
  costSpikeMinTokens: number;
};

export type PendingAiMonitoringSignoff = {
  /** An unsigned, inactive ai_monitoring_config version newer than the one in force. */
  version: number | null;
  rules: AiMonitoringRulesView | null;
  /** The read failed: never render this as an all-clear. */
  failed: boolean;
};

type Row = { version: number; is_active: boolean; approved_at: string | null; config?: unknown };
type Loose = { from(table: string): { select(columns: string): PromiseLike<{ data: Row[] | null; error: unknown }> } };

const FAILED: PendingAiMonitoringSignoff = { version: null, rules: null, failed: true };
const isObj = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

export const ALWAYS_SAMPLED_WORDS: Record<string, string> = {
  emergency_touching: "conversations that touched an emergency or doctor-escalation grade",
  patient_reported: "answers a patient said were wrong",
  cost_spike: "unusually large calls",
};

/** Pure: the panel view from a draft's config, or null when something it must show is missing (the panel then says nothing rather than guess). */
export function aiMonitoringRulesView(config: unknown): AiMonitoringRulesView | null {
  if (!isObj(config) || typeof config.sample_rate !== "number" || !Array.isArray(config.always_sample) || !isObj(config.cost_spike)) return null;
  const { factor, min_tokens: minTokens } = config.cost_spike;
  if (typeof factor !== "number" || typeof minTokens !== "number") return null;
  const groups: string[] = [];
  for (const g of config.always_sample) {
    const words = typeof g === "string" ? ALWAYS_SAMPLED_WORDS[g] : undefined;
    if (!words) return null; // an unknown group is not signed blind
    groups.push(words);
  }
  return { sampleRatePercent: Math.round(config.sample_rate * 1000) / 10, alwaysSampled: groups, costSpikeFactor: factor, costSpikeMinTokens: minTokens };
}

/**
 * What the AI monitoring rules need from the Chief Medical Officer, for the sign-off hub. Nothing signs by itself: the draft stays inactive until the
 * CMO presses the sign control, and the monthly sample is not drawn before then. Never throws.
 */
export async function readPendingAiMonitoringSignoff(supabase: SupabaseClient<Database>): Promise<PendingAiMonitoringSignoff> {
  try {
    const res = await (supabase as unknown as Loose).from("ai_monitoring_config").select("version, is_active, approved_at, config");
    if (res.error || !res.data) return FAILED;
    const version = newestWaiting(res.data);
    return { version, rules: version === null ? null : aiMonitoringRulesView(res.data.find((r) => r.version === version)?.config), failed: false };
  } catch {
    return FAILED;
  }
}
