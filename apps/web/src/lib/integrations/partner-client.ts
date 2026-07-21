import "server-only";
import type { Tables } from "@tarragon/shared";

type PartnerIntegration = Tables<"partner_integrations">;

export type PartnerCallResult =
  | { ok: true; status: number; data: unknown }
  | { ok: false; error: string };

/**
 * Outbound call to a registered partner platform (public.partner_integrations)
 * — the platform-side twin of the inbound API-key path. Same contract as
 * packages/shared/ml-client.ts: never throws, 5-second timeout, a partner
 * being down must never take a TarragonHealth flow down with it.
 *
 * Server-only: the row carries the partner credential, which is sent as the
 * configured header verbatim and must never reach a client bundle.
 */
export async function callPartner(
  integration: Pick<PartnerIntegration, "base_url" | "auth_header" | "secret" | "is_active">,
  path: string,
  init?: { method?: "GET" | "POST" | "PUT" | "DELETE"; body?: unknown }
): Promise<PartnerCallResult> {
  if (!integration.is_active) {
    return { ok: false, error: "Integration is inactive" };
  }

  const url = `${integration.base_url.replace(/\/+$/, "")}/${path.replace(/^\/+/, "")}`;
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (integration.secret) headers[integration.auth_header] = integration.secret;

  try {
    const response = await fetch(url, {
      method: init?.method ?? "GET",
      headers,
      body: init?.body !== undefined ? JSON.stringify(init.body) : undefined,
      signal: AbortSignal.timeout(5000),
    });
    let data: unknown = null;
    try {
      data = await response.json();
    } catch {
      // Non-JSON responses are fine for a reachability check.
    }
    return { ok: true, status: response.status, data };
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : "Partner request failed",
    };
  }
}
