import { describe, expect, it } from "@jest/globals";
import { selectPayment, selectVideo, type FetchLike } from "../../../supabase/functions/_shared/integrations/index.ts";

const noFetch: FetchLike = async () => {
  throw new Error("no network in this test");
};
const zoomEnv = { ZOOM_ACCOUNT_ID: "a", ZOOM_CLIENT_ID: "c", ZOOM_CLIENT_SECRET: "s" };

describe("which vendor runs a consultation", () => {
  it("in production with nothing configured is not_configured, never a mock", () => {
    for (const env of [{}, { APP_ENV: "production" }, { APP_ENV: "prod" }, { APP_ENV: "" }]) {
      expect(selectVideo(env, noFetch)).toMatchObject({ ok: false, error: { code: "not_configured" } });
    }
  });

  it("outside production gives one mock per process, so a room made in one request is found in the next", () => {
    for (const APP_ENV of ["development", "staging", "test"]) {
      const a = selectVideo({ APP_ENV }, noFetch);
      const b = selectVideo({ APP_ENV }, noFetch);
      expect(a.ok && a.data.isMock).toBe(true);
      expect(a.ok && b.ok && a.data === b.data).toBe(true);
    }
  });

  it("a configured real Zoom wins in every environment, including production", () => {
    for (const APP_ENV of ["production", "development"]) {
      const v = selectVideo({ ...zoomEnv, APP_ENV }, noFetch);
      expect(v.ok && v.data.name).toBe("zoom");
      expect(v.ok && v.data.isMock).toBe(false);
    }
  });


  it("Zoom account credentials alone are enough: the Meeting SDK keys are not needed for links", () => {
    expect(selectVideo({ ...zoomEnv, APP_ENV: "production" }, noFetch).ok).toBe(true);
  });
});

describe("which vendor moves payout money", () => {
  it("in production with no Paystack key is not_configured, never a mock", () => {
    expect(selectPayment({ APP_ENV: "production" }, noFetch)).toMatchObject({ ok: false, error: { code: "not_configured" } });
    expect(selectPayment({}, noFetch)).toMatchObject({ ok: false, error: { code: "not_configured" } });
  });

  it("outside production gives one mock per process", () => {
    const a = selectPayment({ APP_ENV: "development" }, noFetch);
    const b = selectPayment({ APP_ENV: "test" }, noFetch);
    expect(a.ok && a.data.isMock).toBe(true);
    expect(a.ok && b.ok && a.data === b.data).toBe(true);
  });

  it("a configured Paystack key wins in every environment, including production", () => {
    for (const APP_ENV of ["production", "development"]) {
      const p = selectPayment({ PAYSTACK_SECRET_KEY: "sk_test_x", APP_ENV }, noFetch);
      expect(p.ok && p.data.name).toBe("paystack");
      expect(p.ok && p.data.isMock).toBe(false);
    }
  });
});
