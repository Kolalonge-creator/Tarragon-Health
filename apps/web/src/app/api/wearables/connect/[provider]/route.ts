import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import {
  getWearableOAuthUrl,
  isWearableProviderConfigured,
  type CloudOAuthWearableProvider,
} from "@/lib/wearables/oauth-providers";
import { createWearableOAuthState } from "@/lib/wearables/state-token";

const VALID_PROVIDERS: CloudOAuthWearableProvider[] = ["oura", "whoop", "garmin", "fitbit"];

function isValidProvider(value: string): value is CloudOAuthWearableProvider {
  return (VALID_PROVIDERS as string[]).includes(value);
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
  const state = createWearableOAuthState(user.id, provider);
  const result = getWearableOAuthUrl(provider, redirectUri, state);

  if (!result.ok) {
    return NextResponse.redirect(
      new URL(`/patient?wearable_error=${encodeURIComponent(result.error)}`, request.url)
    );
  }

  return NextResponse.redirect(result.url);
}
