import { describe, expect, it } from "@jest/globals";
import { signWebhookPayload, verifyWebhookSignature } from "./webhook-signing";

/**
 * A partner's whole reason to trust an inbound "Tarragon" webhook is this
 * signature (§33.15) — these tests exist because a signing bug is silent:
 * an unsigned or wrongly-verified webhook doesn't error, a partner just
 * either rejects everything (looks like our outage) or accepts a forged
 * event (looks like nothing at all, until it's a fabricated clinical
 * event). Each positive case is paired with a negative, per this
 * codebase's own webhook-auth.test.ts convention.
 */

describe("signWebhookPayload / verifyWebhookSignature", () => {
  const secret = "a".repeat(64);
  const body = JSON.stringify({ event_id: "evt_1", event_type: "result.available", data: { foo: "bar" } });

  it("produces a verifiable sha256= signature", () => {
    const signature = signWebhookPayload(secret, body);
    expect(signature).toMatch(/^sha256=[0-9a-f]{64}$/);
    expect(verifyWebhookSignature(secret, body, signature)).toBe(true);
  });

  it("is deterministic for the same secret and body", () => {
    expect(signWebhookPayload(secret, body)).toBe(signWebhookPayload(secret, body));
  });

  it("changes when the body changes", () => {
    const tampered = JSON.stringify({ event_id: "evt_1", event_type: "result.available", data: { foo: "TAMPERED" } });
    expect(signWebhookPayload(secret, body)).not.toBe(signWebhookPayload(secret, tampered));
  });

  it("rejects a signature computed with the wrong secret", () => {
    const wrongSecret = "b".repeat(64);
    const signature = signWebhookPayload(wrongSecret, body);
    expect(verifyWebhookSignature(secret, body, signature)).toBe(false);
  });

  it("rejects a tampered body against a signature for the original body", () => {
    const signature = signWebhookPayload(secret, body);
    const tampered = body.replace("bar", "baz");
    expect(verifyWebhookSignature(secret, tampered, signature)).toBe(false);
  });

  it("rejects a signature of a different length without throwing", () => {
    expect(verifyWebhookSignature(secret, body, "sha256=short")).toBe(false);
  });
});
