import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@tarragon/shared";
import { newestWaiting } from "@/lib/queries/pending-quality-config-signoff";

/** The numbers the sign-off panel shows, read from the draft itself so the words the CMO signs against are the values that will apply. */
export type CapacityRulesView = {
  minLeadHeadroom: number;
  rotaHorizonHours: number;
  restHours: number;
  coverOfferPages: number;
  drillTargetPct: number;
  drillTargetMinutes: number;
};

export type PendingCapacityConfigSignoff = {
  /** An unsigned, inactive capacity_cover_config version newer than the one in force (intake gate, hard rest rule, fire drills). */
  capacityVersion: number | null;
  /** The rules of that draft, for the panel. */
  capacityRules: CapacityRulesView | null;
  /** An unsigned, inactive lead_config version newer than the one in force (the pilot cap). */
  leadVersion: number | null;
  /** The per-lead patient cap in that draft and in the version now in force. */
  leadCapDraft: number | null;
  leadCapInForce: number | null;
  /** The read failed: never render this as an all-clear. */
  failed: boolean;
};

type Row = { version: number; is_active: boolean; approved_at: string | null; rules?: Record<string, unknown> };
type Loose = { from(table: string): { select(columns: string): PromiseLike<{ data: Row[] | null; error: unknown }> } };

const FAILED: PendingCapacityConfigSignoff = { capacityVersion: null, capacityRules: null, leadVersion: null, leadCapDraft: null, leadCapInForce: null, failed: true };

const num = (rules: Record<string, unknown> | undefined, key: string): number | null => {
  const v = rules?.[key];
  return typeof v === "number" ? v : null;
};

/** Pure: the panel numbers from a draft's rules, or null when a number it must show is missing (the panel then says nothing rather than guess). */
export function capacityRulesView(rules: Record<string, unknown> | undefined): CapacityRulesView | null {
  const minLeadHeadroom = num(rules, "min_lead_headroom");
  const rotaHorizonHours = num(rules, "rota_horizon_hours");
  const restHours = num(rules, "rest_hours");
  const coverOfferPages = num(rules, "cover_offer_pages");
  const drillTargetPct = num(rules, "drill_ack_target_pct");
  const targetSeconds = num(rules, "drill_ack_target_seconds");
  if ([minLeadHeadroom, rotaHorizonHours, restHours, coverOfferPages, drillTargetPct, targetSeconds].some((v) => v === null)) return null;
  return {
    minLeadHeadroom: minLeadHeadroom as number,
    rotaHorizonHours: rotaHorizonHours as number,
    restHours: restHours as number,
    coverOfferPages: coverOfferPages as number,
    drillTargetPct: drillTargetPct as number,
    drillTargetMinutes: Math.round((targetSeconds as number) / 60),
  };
}

/**
 * What the capacity and cover configurations need from the Chief Medical Officer, for the sign-off hub. Nothing signs by itself: these are
 * drafts that stay inactive until the CMO presses the sign control. Never throws; a failed read says so.
 */
export async function readPendingCapacityConfigSignoff(supabase: SupabaseClient<Database>): Promise<PendingCapacityConfigSignoff> {
  try {
    const loose = supabase as unknown as Loose;
    const [c, l] = await Promise.all([
      loose.from("capacity_cover_config").select("version, is_active, approved_at, rules"),
      loose.from("lead_config").select("version, is_active, approved_at, rules"),
    ]);
    if (c.error || l.error || !c.data || !l.data) return FAILED;
    const capacityVersion = newestWaiting(c.data);
    const leadVersion = newestWaiting(l.data);
    const leadLive = l.data.filter((r) => r.is_active).sort((a, b) => b.version - a.version)[0];
    return {
      capacityVersion,
      capacityRules: capacityVersion === null ? null : capacityRulesView(c.data.find((r) => r.version === capacityVersion)?.rules),
      leadVersion,
      leadCapDraft: leadVersion === null ? null : num(l.data.find((r) => r.version === leadVersion)?.rules, "max_lead_patients"),
      leadCapInForce: num(leadLive?.rules, "max_lead_patients"),
      failed: false,
    };
  } catch {
    return FAILED;
  }
}
