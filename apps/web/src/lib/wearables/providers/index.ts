import type { CloudOAuthWearableProvider } from "../oauth-providers";
import { dexcomAdapter } from "./dexcom";
import { fitbitAdapter } from "./fitbit";
import { garminAdapter } from "./garmin";
import { ouraAdapter } from "./oura";
import { whoopAdapter } from "./whoop";
import type { ProviderAdapter } from "./types";

export const PROVIDER_ADAPTERS: Record<CloudOAuthWearableProvider, ProviderAdapter> = {
  fitbit: fitbitAdapter,
  whoop: whoopAdapter,
  oura: ouraAdapter,
  garmin: garminAdapter,
  dexcom: dexcomAdapter,
};

/** Providers that can receive a webhook at all. Dexcom is excluded because
 * it has no push mechanism — see its adapter. */
export const WEBHOOK_PROVIDERS: CloudOAuthWearableProvider[] = [
  "oura",
  "whoop",
  "garmin",
  "fitbit",
];

/** Providers a scheduled job must poll, because nothing will ever push. */
export const PULL_PROVIDERS: CloudOAuthWearableProvider[] = ["dexcom"];

export type { ProviderAdapter, WebhookNotification, InlineReadingGroup } from "./types";
