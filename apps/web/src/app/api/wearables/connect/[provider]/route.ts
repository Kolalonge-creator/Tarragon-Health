import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import {
  getWearableOAuthUrl,
  isWearableProviderConfigured,
  type CloudOAuthWearableProvider,
} from "@/lib/wearables/oauth-providers";
import { createWearableOAuthState } from "@/lib/wearables/state-token";
import { FULL_WEARABLE_CONSENT, type WearableConsent } from "@/lib/wearables/normalise";

const VALID_PROVIDERS: CloudOAuthWearableProvider[] = [
  "oura",
  "whoop",
  "garmin",
  "fitbit",
  "dexcom",
];

function isValidProvider(value: string): value is CloudOAuthWearableProvider {
  return (VALID_PROVIDERS as string[]).includes(value);
}

/** `1`/`true` grants the category, anything else (including absent) denies
 * it — an unrecognised or tampered query value must never fall back to
 * "grant everything". */
function categoryGranted(url: URL, param: string): boolean {
  const value = url.searchParams.get(param);
  return value === "1" || value === "true";
}

/**
 * The consent panel on the Connect card (wearable-connect-card.tsx) submits
 * its four checkboxes as query params on this same GET — there is no
 * separate consent-collecting step, so whatever the patient chose has to
 * survive the OAuth round-trip via the signed state token (53.3/53.4).
 * Missing entirely (a plain `/api/wearables/connect/oura` link with no
 * params) defaults to full consent, matching this connection's behaviour
 * before granular consent existed.
 */
function consentFromQuery(url: URL): WearableConsent {
  if (!url.searchParams.has("consent")) return FULL_WEARABLE_CONSENT;
  return {
    activity: categoryGranted(url, "consent_activity"),
    heart_rate: categoryGranted(url, "consent_heart_rate"),
    sleep: categoryGranted(url, "consent_sleep"),
    weight: categoryGranted(url, "consent_weight"),
  };
}

/**
 * Starts the "Connect a wearable" OAuth handshake — the patient-facing
 * Connect UI (wearable-connect-card.tsx) links straight here. Redirects to
 * the provider's real authorize URL when configured; when not (no real
 * developer app registered yet, per CLAUDE.md), redirects back to the
 * dashboard with an error rather than a dead click-through.
 */
export async function GET(
  request: Request,
  { params }: { params: Promise<{ provider: string }> }
): Promise<NextResponse> {
  const { provider } = await params;
  if (!isValidProvider(provider)) {
    return NextResponse.redirect(new URL("/patient?wearable_error=unknown_provider", request.url));
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.redirect(new URL("/login", request.url));
  }

  if (!isWearableProviderConfigured(provider)) {
    return NextResponse.redirect(
      new URL(`/patient?wearable_error=not_configured&provider=${provider}`, request.url)
    );
  }

  const redirectUri = new URL(`/api/wearables/callback/${provider}`, request.url).toString();
  const consent = consentFromQuery(new URL(request.url));
  const state = createWearableOAuthState(user.id, provider, consent);
  const result = getWearableOAuthUrl(provider, redirectUri, state);

  if (!result.ok) {
    return NextResponse.redirect(
      new URL(`/patient?wearable_error=${encodeURIComponent(result.error)}`, request.url)
    );
  }

  return NextResponse.redirect(result.url);
}
