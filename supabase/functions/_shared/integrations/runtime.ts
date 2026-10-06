import type { FetchLike } from "./http.ts";
import { videoFromEnv, type Env } from "./from-env.ts";
import type { ProviderResult } from "./result.ts";
import { environmentFrom, selectProvider } from "./select.ts";
import { createMockVideo } from "./video-mock.ts";
import type { VideoProvider } from "./video.ts";

/**
 * Which vendor runs a consultation in this process (S21). A real, configured vendor wins; outside production a mock stands in
 * (one per process, so a room made in one request is found in the next while developing); in production a missing vendor is a
 * plain `not_configured`, never a silent mock. An unrecognised or missing APP_ENV counts as production. Lives here, with the
 * mocks, so application code never names a mock constructor (the scan in from-env.test.ts enforces that).
 */
let mockVideo: VideoProvider | undefined;

export function selectVideo(env: Env, fetch: FetchLike): ProviderResult<VideoProvider> {
  return selectProvider({ environment: environmentFrom(env["APP_ENV"]), real: videoFromEnv(env, fetch), mock: () => (mockVideo ??= createMockVideo()) });
}
