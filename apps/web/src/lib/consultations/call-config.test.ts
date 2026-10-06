import { describe, expect, it } from "@jest/globals";
import { callPolicyFor, inAppCallAvailable, participantKeySecret, presenceFromWebhook } from "./call-config";

describe("in-app call configuration", () => {
  it("is available only with both Meeting SDK keys, and the secret is the one that mints participant keys", () => {
    expect(inAppCallAvailable({})).toBe(false);
    expect(inAppCallAvailable({ ZOOM_SDK_KEY: "k" })).toBe(false);
    expect(inAppCallAvailable({ ZOOM_SDK_SECRET: "s" })).toBe(false);
    expect(inAppCallAvailable({ ZOOM_SDK_KEY: "", ZOOM_SDK_SECRET: "s" })).toBe(false);
    expect(inAppCallAvailable({ ZOOM_SDK_KEY: "k", ZOOM_SDK_SECRET: "s" })).toBe(true);
    expect(participantKeySecret({ ZOOM_SDK_KEY: "k", ZOOM_SDK_SECRET: "s" })).toBe("s");
    expect(participantKeySecret({ ZOOM_SDK_SECRET: "s" })).toBeNull();
  });

  it("treats presence from the webhook as off unless it is explicitly '1'", () => {
    expect(presenceFromWebhook({})).toBe(false);
    expect(presenceFromWebhook({ ZOOM_PRESENCE_WEBHOOK: "true" })).toBe(false);
    expect(presenceFromWebhook({ ZOOM_PRESENCE_WEBHOOK: "1" })).toBe(true);
  });

  it("builds the page's call policy from the versioned config and the consultation's own grace, or none when unavailable", () => {
    expect(callPolicyFor(120, {})).toBeNull();
    const p = callPolicyFor(90, { ZOOM_SDK_KEY: "k", ZOOM_SDK_SECRET: "the-secret-value" });
    expect(p).toMatchObject({ reconnectGraceSeconds: 90, poorSamplesToDowngrade: 3, sampleIntervalSeconds: 3 });
    // what goes to the browser carries no key or secret
    expect(JSON.stringify(p)).not.toContain("the-secret-value");
  });
});
