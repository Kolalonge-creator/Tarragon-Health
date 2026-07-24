import { isWearableProviderConfigured, type CloudOAuthWearableProvider } from "@/lib/wearables/oauth-providers";
import { WearableConnectCard } from "./wearable-connect-card";

const PROVIDERS: CloudOAuthWearableProvider[] = ["oura", "whoop", "garmin", "fitbit"];

/**
 * Server wrapper so the "which providers are actually configured" check
 * (reads server-only env vars — OURA_CLIENT_ID etc. have no NEXT_PUBLIC_
 * prefix) never needs to cross into client code. Per CLAUDE.md: a
 * provider with no real developer app registered shows as "not yet
 * available" rather than a dead Connect button — the whole reason this UI
 * didn't exist before now.
 */
export function WearableConnectSection({ patientId }: { patientId: string }) {
  const configured = PROVIDERS.filter((provider) => isWearableProviderConfigured(provider));
  return <WearableConnectCard patientId={patientId} configuredProviders={configured} />;
}
