import { describe, expect, it } from "@jest/globals";
import { createMemoryBridgeStore, phoneFromEnv, selectPhone, selectVideo, type FetchLike } from "../../../supabase/functions/_shared/integrations/index.ts";

const noFetch: FetchLike = async () => {
  throw new Error("no network in this test");
};
const zoomEnv = { ZOOM_ACCOUNT_ID: "a", ZOOM_CLIENT_ID: "c", ZOOM_CLIENT_SECRET: "s" };

describe("which vendor runs a consultation", () => {
  it("in production with nothing configured is not_configured, never a mock", () => {
    for (const env of [{}, { APP_ENV: "production" }, { APP_ENV: "prod" }, { APP_ENV: "" }]) {
      expect(selectVideo(env, noFetch)).toMatchObject({ ok: false, error: { code: "not_configured" } });
      expect(selectPhone(env, noFetch, createMemoryBridgeStore())).toMatchObject({ ok: false, error: { code: "not_configured" } });
    }
  });

  it("outside production gives one mock per process, so a room made in one request is found in the next", () => {
    for (const APP_ENV of ["development", "staging", "test"]) {
      const a = selectVideo({ APP_ENV }, noFetch);
      const b = selectVideo({ APP_ENV }, noFetch);
      expect(a.ok && a.data.isMock).toBe(true);
      expect(a.ok && b.ok && a.data === b.data).toBe(true);
      const p = selectPhone({ APP_ENV }, noFetch, createMemoryBridgeStore());
      const q = selectPhone({ APP_ENV }, noFetch, createMemoryBridgeStore());
      expect(p.ok && p.data.isMock).toBe(true);
      expect(p.ok && q.ok && p.data === q.data).toBe(true);
    }
  });

  it("a configured real Zoom wins in every environment, including production", () => {
    for (const APP_ENV of ["production", "development"]) {
      const v = selectVideo({ ...zoomEnv, APP_ENV }, noFetch);
      expect(v.ok && v.data.name).toBe("zoom");
      expect(v.ok && v.data.isMock).toBe(false);
    }
  });

  it("a configured Africa's Talking bridge wins over the mock, in production too, and is built only when all three settings are present", () => {
    const at = { AT_VOICE_USERNAME: "tarragon", AT_VOICE_API_KEY: "k", AT_VOICE_NUMBER: "+2342013330000" };
    for (const APP_ENV of ["production", "development"]) {
      const p = selectPhone({ ...at, APP_ENV }, noFetch, createMemoryBridgeStore());
      expect(p.ok && p.data.name).toBe("africastalking");
      expect(p.ok && p.data.isMock).toBe(false);
    }
    for (const missing of Object.keys(at)) {
      expect(phoneFromEnv({ ...at, [missing]: undefined }, noFetch, createMemoryBridgeStore())).toBeNull();
    }
    expect(phoneFromEnv({ ...at, AT_VOICE_SANDBOX: "true" }, noFetch, createMemoryBridgeStore())).toMatchObject({ name: "africastalking" });
  });

  it("Zoom account credentials alone are enough: the Meeting SDK keys are not needed for links", () => {
    expect(selectVideo({ ...zoomEnv, APP_ENV: "production" }, noFetch).ok).toBe(true);
  });
});
