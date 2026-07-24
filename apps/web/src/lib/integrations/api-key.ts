import "server-only";
import { createHash, randomBytes } from "crypto";
import { createServiceRoleClient } from "@/lib/supabase/service-role";

/**
 * Inbound partner/device API keys (public.api_keys). The full key is
 * `th_live_<64 hex chars>` (256 bits of entropy); only its SHA-256 hash is
 * stored, so issuance is the single moment the key is visible. High-entropy
 * random keys need no per-key salt — a rainbow table over a 256-bit space
 * is not a thing.
 */

export { API_KEY_SCOPES, type ApiKeyScope } from "./api-key-scopes";
import type { ApiKeyScope } from "./api-key-scopes";

export function generateApiKey(): { key: string; keyPrefix: string; keyHash: string } {
  const key = `th_live_${randomBytes(32).toString("hex")}`;
  return { key, keyPrefix: key.slice(0, 16), keyHash: hashApiKey(key) };
}

export function hashApiKey(key: string): string {
  return createHash("sha256").update(key).digest("hex");
}

export interface VerifiedApiKey {
  keyId: string;
  organisationId: string;
  scopes: string[];
}

/**
 * Resolve the presented credential (from `Authorization: Bearer th_live_…`
 * or `X-API-Key`) to its org + scopes, or null if unknown/revoked. Uses the
 * service role — this runs for unauthenticated partner requests, and
 * api_keys RLS is deliberately admin-only.
 */
export async function verifyApiKey(request: Request): Promise<VerifiedApiKey | null> {
  const headerKey =
    request.headers.get("authorization")?.match(/^Bearer (th_live_[0-9a-f]+)$/)?.[1] ??
    request.headers.get("x-api-key");
  if (!headerKey?.startsWith("th_live_")) return null;

  const supabase = createServiceRoleClient();
  const { data: row } = await supabase
    .from("api_keys")
    .select("id, organisation_id, scopes, revoked_at")
    .eq("key_hash", hashApiKey(headerKey))
    .maybeSingle();
  if (!row || row.revoked_at) return null;

  // Best-effort usage stamp — never blocks the request.
  void supabase
    .from("api_keys")
    .update({ last_used_at: new Date().toISOString() })
    .eq("id", row.id)
    .then(() => undefined);

  return { keyId: row.id, organisationId: row.organisation_id, scopes: row.scopes };
}

export function hasScope(verified: VerifiedApiKey, scope: ApiKeyScope): boolean {
  return verified.scopes.includes(scope);
}
