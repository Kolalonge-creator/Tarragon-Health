/**
 * The live-mode gate for a stored protocol version (S59d).
 *
 * A triage protocol reaches a patient only when its row is ACTIVE and carries a recorded signature (`approved_at` and
 * `approved_by`), which only `public.sign_triage_protocols` (Chief Medical Officer) can set. Every draft this repository ships
 * (the S59 paediatric draft, the S59d pathways) is inserted inactive and unsigned, so this gate is what keeps a draft pathway
 * from ever being offered or run. The function is pure and fails closed: anything it cannot positively confirm is "not live".
 */
import { parseTriageProtocolConfig, type PresentingComplaintProtocol, type TriageProtocolConfig } from "../types/index";

export interface StoredTriageProtocolRow {
  version: number;
  config: unknown;
  is_active: boolean | null;
  approved_at: string | null;
  approved_by: string | null;
}

/** True only for an active, signed row. A draft, an unsigned active row, or a half-signed row is not live. */
export function isLiveProtocolRow(row: StoredTriageProtocolRow | null | undefined): boolean {
  if (!row) return false;
  if (row.is_active !== true) return false;
  if (typeof row.approved_at !== "string" || row.approved_at.length === 0) return false;
  if (typeof row.approved_by !== "string" || row.approved_by.length === 0) return false;
  return true;
}

/**
 * The parsed config of a live row, or null when the row is not live or malformed. The ROW's version is authoritative and is stamped
 * onto the config: the admin "re-attest" action inserts version N+1 with the config copied unchanged (its inner `version` still
 * says N), and signing that row must keep the checker running, not switch it off.
 */
export function liveProtocolConfig(row: StoredTriageProtocolRow | null | undefined): { config: TriageProtocolConfig; protocolVersion: number } | null {
  if (!row || !isLiveProtocolRow(row)) return null;
  const config = parseTriageProtocolConfig(row.config);
  if (!config) return null;
  return { config: { ...config, version: row.version }, protocolVersion: row.version };
}

/** One pathway of a live row, or null. A pathway that exists only in a draft row can never be returned. */
export function selectLivePathway(
  row: StoredTriageProtocolRow | null | undefined,
  presentingComplaintKey: string,
): { pathway: PresentingComplaintProtocol; protocolVersion: number } | null {
  const live = liveProtocolConfig(row);
  if (!live) return null;
  const pathway = live.config.pathways.find((p) => p.key === presentingComplaintKey);
  return pathway ? { pathway, protocolVersion: live.protocolVersion } : null;
}

/**
 * The pathways an engine may be built from in live mode: the whole config of a live row, and NOTHING for a draft or unsigned row.
 * `createInHouseEngine({ pathways: livePathways(row) })` therefore has no pathway to run for a draft, and the safe wrapper turns
 * that into the escalating "protocol unavailable" result, never reassurance.
 */
export function livePathways(row: StoredTriageProtocolRow | null | undefined): readonly PresentingComplaintProtocol[] {
  return liveProtocolConfig(row)?.config.pathways ?? [];
}
