import { NextResponse } from "next/server";
import { createServiceRoleClient } from "@/lib/supabase/service-role";
import type { CloudOAuthWearableProvider } from "@/lib/wearables/oauth-providers";
import { verifyWearableOAuthState } from "@/lib/wearables/state-token";
import { exchangeWearableOAuthCode } from "@/lib/wearables/token-exchange";

const VALID_PROVIDERS: CloudOAuthWearableProvider[] = ["oura", "whoop", "garmin", "fitbit"];

function isValidProvider(value: string): value is CloudOAuthWearableProvider {
  return (VALID_PROVIDERS as string[]).includes(value);
}

/**
 * OAuth callback for the wearable Connect flow. Exchanges the authorization
 * code for tokens, then records the connection — service-role, since a
 * patient's own RLS-scoped session shouldn't need to know the token exists,
 * and wearable_connections' token columns are meant to stay a server-only
 * concern (see the migration comment on access_token).
 *
 * Re-pairing is a new row, not an overwrite (matches
 * wearable_connections_patient_provider_active_idx's partial-unique-when-
 * active design, same as patient_devices' BLE re-pairing) — any existing
 * active connection for this provider is marked 'disconnected' first.
 */
export async function GET(
  request: Request,
  { params }: { params: Promise<{ provider: string }> }
): Promise<NextResponse> {
  const { provider } = await params;
  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  const providerError = url.searchParams.get("error");

  if (!isValidProvider(provider)) {
    return NextResponse.redirect(new URL("/patient?wearable_error=unknown_provider", request.url));
  }
  if (providerError) {
    return NextResponse.redirect(
      new URL(`/patient?wearable_error=${encodeURIComponent(providerError)}`, request.url)
    );
  }
  if (!code || !state) {
    return NextResponse.redirect(new URL("/patient?wearable_error=missing_code_or_state", request.url));
  }

  const verified = verifyWearableOAuthState(state, provider);
  if (!verified.ok) {
    return NextResponse.redirect(
      new URL(`/patient?wearable_error=${encodeURIComponent(verified.error)}`, request.url)
    );
  }

  const redirectUri = new URL(`/api/wearables/callback/${provider}`, request.url).toString();
  const exchange = await exchangeWearableOAuthCode(provider, code, redirectUri);
  if (!exchange.ok) {
    return NextResponse.redirect(
      new URL(`/patient?wearable_error=${encodeURIComponent(exchange.error)}`, request.url)
    );
  }

  const svc = createServiceRoleClient();

  const { data: patient } = await svc
    .from("profiles")
    .select("organisation_id")
    .eq("id", verified.patientId)
    .maybeSingle();
  if (!patient?.organisation_id) {
    return NextResponse.redirect(new URL("/patient?wearable_error=no_organisation", request.url));
  }

  await svc
    .from("wearable_connections")
    .update({ status: "disconnected" })
    .eq("patient_id", verified.patientId)
    .eq("provider", provider)
    .eq("status", "active");

  const tokenExpiresAt = exchange.expiresInSeconds
    ? new Date(Date.now() + exchange.expiresInSeconds * 1000).toISOString()
    : null;

  const { error: insertError } = await svc.from("wearable_connections").insert({
    organisation_id: patient.organisation_id,
    patient_id: verified.patientId,
    provider,
    status: "active",
    external_id: exchange.externalId,
    access_token: exchange.accessToken,
    refresh_token: exchange.refreshToken,
    token_expires_at: tokenExpiresAt,
  });
  if (insertError) {
    return NextResponse.redirect(
      new URL(`/patient?wearable_error=${encodeURIComponent(insertError.message)}`, request.url)
    );
  }

  return NextResponse.redirect(new URL(`/patient?wearable_connected=${provider}`, request.url));
}
