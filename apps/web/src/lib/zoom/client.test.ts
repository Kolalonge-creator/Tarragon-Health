import { describe, expect, it, afterEach } from "@jest/globals";
import { isZoomConfigured } from "./client";

const ENV_KEYS = ["ZOOM_ACCOUNT_ID", "ZOOM_CLIENT_ID", "ZOOM_CLIENT_SECRET"] as const;

function clearZoomEnv() {
  for (const key of ENV_KEYS) delete process.env[key];
}

describe("isZoomConfigured", () => {
  afterEach(() => {
    clearZoomEnv();
  });

  it("is false when no Zoom credentials are set", () => {
    clearZoomEnv();
    expect(isZoomConfigured()).toBe(false);
  });

  it("is false when only some credentials are set", () => {
    clearZoomEnv();
    process.env.ZOOM_ACCOUNT_ID = "acct";
    process.env.ZOOM_CLIENT_ID = "client";
    expect(isZoomConfigured()).toBe(false);
  });

  it("is true once all three credentials are set", () => {
    clearZoomEnv();
    process.env.ZOOM_ACCOUNT_ID = "acct";
    process.env.ZOOM_CLIENT_ID = "client";
    process.env.ZOOM_CLIENT_SECRET = "secret";
    expect(isZoomConfigured()).toBe(true);
  });
});
