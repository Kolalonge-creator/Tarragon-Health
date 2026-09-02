import "server-only";
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
export async function getActiveTriageProtocolConfig(): Promise<{
  config: TriageProtocolConfig;
  protocolVersion: number;
} | null> {
  const supabase = await createClient();
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

export async function getActivePathway(
  presentingComplaintKey: string
): Promise<{ pathway: PresentingComplaintProtocol; protocolVersion: number } | null> {
  const active = await getActiveTriageProtocolConfig();
  if (!active) return null;

  const pathway = active.config.pathways.find((p) => p.key === presentingComplaintKey);
  if (!pathway) return null;

  return { pathway, protocolVersion: active.protocolVersion };
}
