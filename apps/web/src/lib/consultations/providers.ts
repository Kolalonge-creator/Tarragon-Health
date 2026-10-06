import "server-only";
import { selectPhone, selectVideo, type FetchLike, type PhoneBridgeProvider, type ProviderResult, type VideoProvider } from "@tarragon/integrations";
import { createBridgeStore } from "./bridge-store";

/**
 * S21: which vendor runs a consultation. The choice (a real configured vendor first, a mock outside production only, a plain
 * `not_configured` in production) lives in the integrations package so application code never names a mock. Set
 * APP_ENV=development locally to get the mocks. An unrecognised or missing APP_ENV counts as production.
 */
const vendorFetch: FetchLike = (url, init) => fetch(url, { method: init.method, headers: init.headers, body: init.body, signal: init.signal });

export function videoProvider(): ProviderResult<VideoProvider> {
  return selectVideo(process.env, vendorFetch);
}

/** Africa's Talking when AT_VOICE_* is set; a mock outside production; not_configured in production until then (OQ-131). */
export function phoneProvider(): ProviderResult<PhoneBridgeProvider> {
  return selectPhone(process.env, vendorFetch, createBridgeStore());
}
