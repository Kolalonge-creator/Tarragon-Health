import "server-only";
import {
  createMockPhone,
  createMockVideo,
  environmentFrom,
  selectProvider,
  videoFromEnv,
  type FetchLike,
  type PhoneBridgeProvider,
  type ProviderResult,
  type VideoProvider,
} from "@tarragon/integrations";

/**
 * S21: which vendor runs a consultation. `selectProvider` gives a real, configured vendor first, a mock outside production
 * only, and a plain `not_configured` in production, so a mock can never answer "joined" or "ringing" for a real patient.
 * Set APP_ENV=development locally to get the mocks. An unrecognised or missing APP_ENV counts as production.
 */
const vendorFetch: FetchLike = (url, init) => fetch(url, { method: init.method, headers: init.headers, body: init.body, signal: init.signal });

const environment = () => environmentFrom(process.env.APP_ENV);

// One mock per server process, so a room made in one request can be found in the next while developing.
let mockVideo: VideoProvider | undefined;
let mockPhone: PhoneBridgeProvider | undefined;

export function videoProvider(): ProviderResult<VideoProvider> {
  return selectProvider({ environment: environment(), real: videoFromEnv(process.env, vendorFetch), mock: () => (mockVideo ??= createMockVideo()) });
}

/** No phone bridge vendor is chosen yet (OQ-131), so there is no real one: production reports not_configured until there is. */
export function phoneProvider(): ProviderResult<PhoneBridgeProvider> {
  return selectProvider<PhoneBridgeProvider>({ environment: environment(), real: null, mock: () => (mockPhone ??= createMockPhone()) });
}
