import { afterEach, beforeEach, describe, expect, it } from "@jest/globals";
import { createHmac } from "crypto";
import { handleVerificationChallenge, verifyWebhookRequest } from "./webhook-auth";

/**
 * These tests exist because the failure they guard against is silent: an
 * unauthenticated webhook does not error, it just accepts whatever it is
 * given and writes it into a patient's clinical record. Each case is
 * deliberately paired with its negative — a check that only ever passes is
 * indistinguishable from no check at all.
 */

const ENV_KEYS = [
  "FITBIT_CLIENT_ID",
  "FITBIT_CLIENT_SECRET",
  "WHOOP_CLIENT_ID",
  "WHOOP_CLIENT_SECRET",
  "OURA_WEBHOOK_SECRET",
  "GARMIN_WEBHOOK_SECRET",
  "FITBIT_WEBHOOK_VERIFICATION_CODE",
  "OURA_WEBHOOK_VERIFICATION_TOKEN",
];

const original: Record<string, string | undefined> = {};

beforeEach(() => {
  for (const key of ENV_KEYS) {
    original[key] = process.env[key];
    delete process.env[key];
  }
});

afterEach(() => {
  for (const key of ENV_KEYS) {
    if (original[key] === undefined) delete process.env[key];
    else process.env[key] = original[key];
  }
});

function requestWith(headers: Record<string, string>, url = "https://app.example.com/api/wearables/webhook/fitbit") {
  return new Request(url, { method: "POST", headers });
}

describe("verifyWebhookRequest — Fitbit", () => {
  const body = '[{"collectionType":"activities","date":"2026-08-08","ownerId":"ABC123"}]';

  beforeEach(() => {
    process.env.FITBIT_CLIENT_ID = "id";
    process.env.FITBIT_CLIENT_SECRET = "sekrit";
  });

  it("accepts a correctly signed body", () => {
    const signature = createHmac("sha1", "sekrit&").update(body).digest("base64");
    const result = verifyWebhookRequest("fitbit", requestWith({ "x-fitbit-signature": signature }), body);
    expect(result).toEqual({ ok: true });
  });

  it("rejects a signature computed over a different body", () => {
    const signature = createHmac("sha1", "sekrit&").update("something else").digest("base64");
    const result = verifyWebhookRequest("fitbit", requestWith({ "x-fitbit-signature": signature }), body);
    expect(result.ok).toBe(false);
  });

  it("rejects a signature keyed without Fitbit's trailing ampersand", () => {
    // The ampersand is easy to drop and the mistake would look like a
    // provider-side problem rather than an implementation one.
    const signature = createHmac("sha1", "sekrit").update(body).digest("base64");
    expect(verifyWebhookRequest("fitbit", requestWith({ "x-fitbit-signature": signature }), body).ok).toBe(
      false
    );
  });

  it("rejects a request with no signature at all", () => {
    expect(verifyWebhookRequest("fitbit", requestWith({}), body).ok).toBe(false);
  });

  it("refuses rather than fails open when the secret is unconfigured", () => {
    delete process.env.FITBIT_CLIENT_SECRET;
    const result = verifyWebhookRequest("fitbit", requestWith({ "x-fitbit-signature": "x" }), body);
    expect(result).toEqual({ ok: false, status: 503, error: "Fitbit credentials not configured" });
  });
});

describe("verifyWebhookRequest — WHOOP", () => {
  const body = '{"user_id":42,"id":"9","type":"recovery.updated"}';

  beforeEach(() => {
    process.env.WHOOP_CLIENT_ID = "id";
    process.env.WHOOP_CLIENT_SECRET = "whoop-secret";
  });

  function sign(timestamp: string, payload: string) {
    return createHmac("sha256", "whoop-secret").update(timestamp + payload).digest("base64");
  }

  it("accepts a correctly signed, fresh request", () => {
    const timestamp = String(Date.now());
    const result = verifyWebhookRequest(
      "whoop",
      requestWith({
        "x-whoop-signature": sign(timestamp, body),
        "x-whoop-signature-timestamp": timestamp,
      }),
      body
    );
    expect(result).toEqual({ ok: true });
  });

  it("rejects a replay of a correctly signed but stale request", () => {
    const timestamp = String(Date.now() - 10 * 60 * 1000);
    const result = verifyWebhookRequest(
      "whoop",
      requestWith({
        "x-whoop-signature": sign(timestamp, body),
        "x-whoop-signature-timestamp": timestamp,
      }),
      body
    );
    expect(result.ok).toBe(false);
  });

  it("rejects a signature that omits the timestamp prefix", () => {
    const timestamp = String(Date.now());
    const signature = createHmac("sha256", "whoop-secret").update(body).digest("base64");
    const result = verifyWebhookRequest(
      "whoop",
      requestWith({ "x-whoop-signature": signature, "x-whoop-signature-timestamp": timestamp }),
      body
    );
    expect(result.ok).toBe(false);
  });
});

describe("verifyWebhookRequest — unsigned providers", () => {
  it("accepts the shared secret from the registered URL", () => {
    process.env.OURA_WEBHOOK_SECRET = "shared";
    const request = new Request("https://app.example.com/api/wearables/webhook/oura?secret=shared", {
      method: "POST",
    });
    expect(verifyWebhookRequest("oura", request, "{}")).toEqual({ ok: true });
  });

  it("accepts the shared secret from a header", () => {
    process.env.GARMIN_WEBHOOK_SECRET = "shared";
    const request = requestWith(
      { "x-tarragon-webhook-secret": "shared" },
      "https://app.example.com/api/wearables/webhook/garmin"
    );
    expect(verifyWebhookRequest("garmin", request, "{}")).toEqual({ ok: true });
  });

  it("rejects a wrong secret", () => {
    process.env.OURA_WEBHOOK_SECRET = "shared";
    const request = new Request("https://app.example.com/api/wearables/webhook/oura?secret=guess", {
      method: "POST",
    });
    expect(verifyWebhookRequest("oura", request, "{}").ok).toBe(false);
  });

  it("rejects everything while the secret is unconfigured", () => {
    const request = new Request("https://app.example.com/api/wearables/webhook/oura?secret=anything", {
      method: "POST",
    });
    const result = verifyWebhookRequest("oura", request, "{}");
    expect(result).toEqual({ ok: false, status: 503, error: "OURA_WEBHOOK_SECRET is not configured" });
  });

  it("never treats Dexcom as a webhook provider", () => {
    expect(verifyWebhookRequest("dexcom", requestWith({}), "{}")).toEqual({
      ok: false,
      status: 404,
      error: "Provider does not accept webhooks",
    });
  });
});

describe("handleVerificationChallenge", () => {
  it("answers Fitbit's correct code with 204 and a wrong one with 404", () => {
    process.env.FITBIT_WEBHOOK_VERIFICATION_CODE = "right-code";
    const good = handleVerificationChallenge(
      "fitbit",
      new Request("https://app.example.com/api/wearables/webhook/fitbit?verify=right-code")
    );
    const bad = handleVerificationChallenge(
      "fitbit",
      new Request("https://app.example.com/api/wearables/webhook/fitbit?verify=wrong-code")
    );
    // Fitbit sends both and fails the subscription if they are answered the
    // same way, so this pair is the whole protocol.
    expect(good?.status).toBe(204);
    expect(bad?.status).toBe(404);
  });

  it("echoes Oura's challenge only when the verification token matches", async () => {
    process.env.OURA_WEBHOOK_VERIFICATION_TOKEN = "tok";
    const good = handleVerificationChallenge(
      "oura",
      new Request("https://app.example.com/api/wearables/webhook/oura?verification_token=tok&challenge=abc")
    );
    expect(good?.status).toBe(200);
    await expect(good?.json()).resolves.toEqual({ challenge: "abc" });

    const bad = handleVerificationChallenge(
      "oura",
      new Request("https://app.example.com/api/wearables/webhook/oura?verification_token=no&challenge=abc")
    );
    expect(bad?.status).toBe(401);
  });

  it("returns null for a request that is not a handshake, so the route can 404", () => {
    expect(
      handleVerificationChallenge("fitbit", new Request("https://app.example.com/api/wearables/webhook/fitbit"))
    ).toBeNull();
  });
});
