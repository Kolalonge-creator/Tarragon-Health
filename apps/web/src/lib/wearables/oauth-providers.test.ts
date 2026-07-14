import { describe, expect, it, beforeEach, afterEach } from "@jest/globals";
import {
  getWearableOAuthUrl,
  isWearableProviderConfigured,
  type CloudOAuthWearableProvider,
} from "./oauth-providers";

const PROVIDER_ENV_VARS: Record<CloudOAuthWearableProvider, [string, string]> = {
  oura: ["OURA_CLIENT_ID", "OURA_CLIENT_SECRET"],
  whoop: ["WHOOP_CLIENT_ID", "WHOOP_CLIENT_SECRET"],
  garmin: ["GARMIN_CLIENT_ID", "GARMIN_CLIENT_SECRET"],
  fitbit: ["FITBIT_CLIENT_ID", "FITBIT_CLIENT_SECRET"],
};

const ALL_ENV_VARS = Object.values(PROVIDER_ENV_VARS).flat();
const originalEnv: Record<string, string | undefined> = {};

beforeEach(() => {
  for (const key of ALL_ENV_VARS) {
    originalEnv[key] = process.env[key];
    delete process.env[key];
  }
});

afterEach(() => {
  for (const key of ALL_ENV_VARS) {
    if (originalEnv[key] === undefined) delete process.env[key];
    else process.env[key] = originalEnv[key];
  }
});

describe("isWearableProviderConfigured", () => {
  it.each(Object.keys(PROVIDER_ENV_VARS) as CloudOAuthWearableProvider[])(
    "%s is unconfigured when its env vars are unset",
    (provider) => {
      expect(isWearableProviderConfigured(provider)).toBe(false);
    }
  );

  it("becomes configured once both env vars are set", () => {
    process.env.OURA_CLIENT_ID = "id";
    process.env.OURA_CLIENT_SECRET = "secret";
    expect(isWearableProviderConfigured("oura")).toBe(true);
  });

  it("stays unconfigured if only one of the two env vars is set", () => {
    process.env.OURA_CLIENT_ID = "id";
    expect(isWearableProviderConfigured("oura")).toBe(false);
  });
});

describe("getWearableOAuthUrl", () => {
  it("fails gracefully (never throws) when the provider isn't configured", () => {
    const result = getWearableOAuthUrl("whoop", "https://app.example.com/callback", "state123");
    expect(result).toEqual({ ok: false, error: "WHOOP_CLIENT_ID is not configured" });
  });

  it("builds a correct authorization URL once configured", () => {
    process.env.FITBIT_CLIENT_ID = "abc123";
    process.env.FITBIT_CLIENT_SECRET = "shh";
    const result = getWearableOAuthUrl("fitbit", "https://app.example.com/callback", "state456");
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const url = new URL(result.url);
    expect(url.origin + url.pathname).toBe("https://www.fitbit.com/oauth2/authorize");
    expect(url.searchParams.get("client_id")).toBe("abc123");
    expect(url.searchParams.get("redirect_uri")).toBe("https://app.example.com/callback");
    expect(url.searchParams.get("response_type")).toBe("code");
    expect(url.searchParams.get("state")).toBe("state456");
    expect(url.searchParams.get("scope")).toBe("activity heartrate sleep weight");
  });

  it("never includes a client secret in the returned URL", () => {
    process.env.OURA_CLIENT_ID = "id";
    process.env.OURA_CLIENT_SECRET = "super-secret-value";
    const result = getWearableOAuthUrl("oura", "https://app.example.com/callback", "state789");
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.url).not.toContain("super-secret-value");
    }
  });
});
