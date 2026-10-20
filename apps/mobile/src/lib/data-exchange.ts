import { supabase } from "./supabase";
import { cacheDelete, cacheWrite, isOffline, readThrough, type ReadResult } from "./passport-cache";

/**
 * Records from other places (S44, spec 2.10 and 2.11) on the phone: which named outside systems the person allows to send records to them (or to
 * receive theirs), what was received, who made a copy of their record, and stopping a system at any time. Same database functions as the web page
 * (apps/web/src/app/(dashboard)/patient/data-exchange).
 *
 * Nothing received here is part of the record: a care team member reviews each item before it joins. The consent wording is a placeholder until
 * counsel approves it (OQ-S44-1) and the screen says so, as the web page does. Only the person themselves sees this, so it is not offered while
 * acting for someone else. Changing a consent needs a connection and says so.
 */
export type ExchangeDirection = "import" | "export" | "both";

export interface ExchangeConsent {
  id: string;
  sourceSystem: string;
  direction: ExchangeDirection;
  grantedAt: string;
  withdrawnAt: string | null;
}

export interface ReceivedRecord {
  id: string;
  importedAt: string;
  resourceType: string;
  sourceSystem: string;
  supersededAt: string | null;
  disposition: "proposed" | "stored_only" | string;
}

export interface CopyEntry {
  id: string;
  createdAt: string;
  requesterKind: "self" | "supporter" | "staff" | string;
}

export interface ExchangeData {
  consents: ExchangeConsent[];
  received: ReceivedRecord[];
  copies: CopyEntry[];
}

const DIRECTIONS: readonly string[] = ["import", "export", "both"];

export function parseConsents(rows: unknown): ExchangeConsent[] {
  if (!Array.isArray(rows)) return [];
  const out: ExchangeConsent[] = [];
  for (const r of rows as Record<string, unknown>[]) {
    if (!r || typeof r.id !== "string" || typeof r.source_system !== "string" || typeof r.granted_at !== "string" || !DIRECTIONS.includes(r.direction as string)) continue;
    out.push({ id: r.id, sourceSystem: r.source_system, direction: r.direction as ExchangeDirection, grantedAt: r.granted_at, withdrawnAt: typeof r.withdrawn_at === "string" ? r.withdrawn_at : null });
  }
  return out;
}

export function parseReceived(rows: unknown): ReceivedRecord[] {
  if (!Array.isArray(rows)) return [];
  const out: ReceivedRecord[] = [];
  for (const r of rows as Record<string, unknown>[]) {
    if (!r || typeof r.id !== "string" || typeof r.imported_at !== "string" || typeof r.fhir_resource_type !== "string" || typeof r.source_system !== "string") continue;
    out.push({
      id: r.id,
      importedAt: r.imported_at,
      resourceType: r.fhir_resource_type,
      sourceSystem: r.source_system,
      supersededAt: typeof r.superseded_at === "string" ? r.superseded_at : null,
      disposition: typeof r.disposition === "string" ? r.disposition : "stored_only",
    });
  }
  return out;
}

export function parseCopies(rows: unknown): CopyEntry[] {
  if (!Array.isArray(rows)) return [];
  const out: CopyEntry[] = [];
  for (const r of rows as Record<string, unknown>[]) {
    if (!r || typeof r.id !== "string" || typeof r.created_at !== "string") continue;
    out.push({ id: r.id, createdAt: r.created_at, requesterKind: typeof r.requester_kind === "string" ? r.requester_kind : "self" });
  }
  return out;
}

export const exchangeCacheKey = (userId: string) => `exchange:${userId}`;

export function loadExchange(userId: string): Promise<ReadResult<ExchangeData>> {
  return readThrough(exchangeCacheKey(userId), async () => {
    const [consents, received, copies] = await Promise.all([
      supabase.rpc("my_external_exchange_consents"),
      supabase.rpc("my_external_records", { p_limit: 50 }),
      supabase.from("fhir_export_log").select("id, requester_kind, sections, created_at").eq("patient_id", userId).order("created_at", { ascending: false }).limit(20),
    ]);
    const failed = consents.error ?? received.error ?? copies.error;
    if (failed) return { ok: false, error: failed };
    return { ok: true, data: { consents: parseConsents(consents.data), received: parseReceived(received.data), copies: parseCopies(copies.data) } };
  });
}

export type ExchangeWrite = { ok: true } | { ok: false; reason: "offline" | "failed" | "name_needed" };

/** The person allows one named outside system. The database normalises the name and records the consent with the placeholder wording key. */
export async function grantConsent(source: string, direction: ExchangeDirection): Promise<ExchangeWrite> {
  const name = source.trim();
  if (name.length < 2 || name.length > 120) return { ok: false, reason: "name_needed" };
  const { error } = await supabase.rpc("grant_external_exchange_consent", { p_source: name, p_direction: direction });
  if (error) return { ok: false, reason: isOffline(error) ? "offline" : "failed" };
  return { ok: true };
}

/** The person stops allowing a system. From that moment the next import from it is refused and stores nothing. */
export async function withdrawConsent(id: string): Promise<ExchangeWrite> {
  const { error } = await supabase.rpc("withdraw_external_exchange_consent", { p_id: id });
  if (error) return { ok: false, reason: isOffline(error) ? "offline" : "failed" };
  return { ok: true };
}

/** After a change the screen applied locally: keep the saved copy in step, so a later offline open does not show a stopped system as allowed. */
export async function saveExchangeCopy(userId: string, data: ExchangeData): Promise<void> {
  await cacheWrite(exchangeCacheKey(userId), data);
}

/** After a grant the new consent's id is not known until a read: drop the saved copy rather than keep one that lacks it. */
export async function forgetExchangeCopy(userId: string): Promise<void> {
  await cacheDelete(exchangeCacheKey(userId));
}
