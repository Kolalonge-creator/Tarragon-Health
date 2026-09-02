import "server-only";
import { createHash, randomBytes } from "crypto";
import { createServiceRoleClient } from "@/lib/supabase/service-role";
import type { Database } from "@tarragon/shared";

/**
 * Inbound partner/device API keys (public.api_keys). The full key is
 * `th_live_<64 hex chars>` (or `th_test_<64 hex chars>` for a §33.17
 * sandbox credential); only its SHA-256 hash is stored, so issuance is the
 * single moment the key is visible. High-entropy random keys need no
 * per-key salt — a rainbow table over a 256-bit space is not a thing.
 */

export { API_KEY_SCOPES, type ApiKeyScope } from "./api-key-scopes";
import type { ApiKeyScope } from "./api-key-scopes";

export type ApiEnvironment = Database["public"]["Enums"]["api_environment"];

export function generateApiKey(
  environment: ApiEnvironment = "live"
): { key: string; keyPrefix: string; keyHash: string; environment: ApiEnvironment } {
  const prefix = environment === "sandbox" ? "th_test_" : "th_live_";
  const key = `${prefix}${randomBytes(32).toString("hex")}`;
  return { key, keyPrefix: key.slice(0, 16), keyHash: hashApiKey(key), environment };
}

export function hashApiKey(key: string): string {
  return createHash("sha256").update(key).digest("hex");
}

export interface VerifiedApiKey {
  keyId: string;
  organisationId: string;
  scopes: string[];
  environment: ApiEnvironment;
  rateLimitPerMinute: number;
  partnerIntegrationId: string | null;
}

/**
 * Resolve the presented credential (from `Authorization: Bearer th_live_…`
 * / `Bearer th_test_…` or `X-API-Key`) to its org + scopes, or null if
 * unknown/revoked/expired. Uses the service role — this runs for
 * unauthenticated partner requests, and api_keys RLS is deliberately
 * admin-only.
 */
export async function verifyApiKey(request: Request): Promise<VerifiedApiKey | null> {
  const headerKey =
    request.headers.get("authorization")?.match(/^Bearer (th_(?:live|test)_[0-9a-f]+)$/)?.[1] ??
    request.headers.get("x-api-key");
  if (!headerKey || !/^th_(live|test)_[0-9a-f]+$/.test(headerKey)) return null;

  const supabase = createServiceRoleClient();
  const { data: row } = await supabase
    .from("api_keys")
    .select("id, organisation_id, scopes, revoked_at, environment, rate_limit_per_minute, partner_integration_id, expires_at")
    .eq("key_hash", hashApiKey(headerKey))
    .maybeSingle();
  if (!row || row.revoked_at) return null;
  if (row.expires_at && new Date(row.expires_at).getTime() <= Date.now()) return null;

  // Best-effort usage stamp — never blocks the request.
  void supabase
    .from("api_keys")
    .update({ last_used_at: new Date().toISOString() })
    .eq("id", row.id)
    .then(() => undefined);

  return {
    keyId: row.id,
    organisationId: row.organisation_id,
    scopes: row.scopes,
    environment: row.environment,
    rateLimitPerMinute: row.rate_limit_per_minute,
    partnerIntegrationId: row.partner_integration_id,
  };
}

export function hasScope(verified: VerifiedApiKey, scope: ApiKeyScope): boolean {
  return verified.scopes.includes(scope);
}
