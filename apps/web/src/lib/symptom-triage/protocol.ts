import "server-only";
import { SYMPTOM_CHECKER_GUARD } from "@/lib/go-live/constants";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@tarragon/shared";
import { createClient } from "@/lib/supabase/server";
import {
  parseTriageProtocolConfig,
  type PresentingComplaintProtocol,
  type TriageProtocolConfig,
} from "@tarragon/symptom-triage-engine";

/**
 * Fetches the ACTIVE, Clinical-Director-signed triage protocol config
 * (private.active_triage_protocol_config(), exposed here via a plain
 * select since RLS already lets any authenticated caller read
 * triage_protocols — the private fn is for trigger-internal SQL use, this
 * is the app-layer equivalent). Returns null when nothing is signed yet —
 * the caller must treat that as "the symptom checker is not available"
 * (fail closed on an unreviewed clinical ruleset, see the
 * triage_protocols migration).
 */
export async function getActiveTriageProtocolConfig(client?: SupabaseClient<Database>): Promise<{
  config: TriageProtocolConfig;
  protocolVersion: number;
} | null> {
  const supabase = client ?? (await createClient());
  const { data, error } = await supabase
    .from("triage_protocols")
    .select("config, version")
    .eq("is_active", true)
    .maybeSingle();

  if (error || !data) return null;

  const config = parseTriageProtocolConfig(data.config);
  if (!config) return null;

  return { config, protocolVersion: data.version };
}

/**
 * F1 (INV-14, server side): whether the symptom checker is open for the signed-in person. The go-live guard
 * `symptom_checker_enabled` is seeded OFF; symptom_triage_assessments refuses the insert in the database too
 * (trigger symptom_triage_assessments_00_go_live_guard), so this only decides what the screen and the action do.
 * Fails closed: an error, no answer or no session is "not open".
 */
export async function isSymptomCheckerOpen(client?: SupabaseClient<Database>): Promise<boolean> {
  const supabase = client ?? (await createClient());
  const { data, error } = await supabase.rpc("go_live_guard_is_open", { p_key: SYMPTOM_CHECKER_GUARD });
  if (error) return false;
  return data === true;
}

export async function getActivePathway(
  presentingComplaintKey: string,
  client?: SupabaseClient<Database>,
): Promise<{ pathway: PresentingComplaintProtocol; protocolVersion: number } | null> {
  const active = await getActiveTriageProtocolConfig(client);
  if (!active) return null;

  const pathway = active.config.pathways.find((p) => p.key === presentingComplaintKey);
  if (!pathway) return null;

  return { pathway, protocolVersion: active.protocolVersion };
}
