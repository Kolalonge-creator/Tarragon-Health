import { createHmac } from "node:crypto";
import { describe, expect, it } from "@jest/globals";
import { verifyZoomSignature } from "./webhook-signature";

const SECRET = "test-secret-token";

function sign(rawBody: string, timestamp: string): string {
  return `v0=${createHmac("sha256", SECRET).update(`v0:${timestamp}:${rawBody}`).digest("hex")}`;
}

describe("verifyZoomSignature", () => {
  it("accepts a correctly signed payload", () => {
    const rawBody = '{"event":"meeting.started"}';
    const timestamp = "1700000000";
    expect(verifyZoomSignature(rawBody, timestamp, sign(rawBody, timestamp), SECRET)).toBe(true);
  });

  it("rejects a tampered body", () => {
    const timestamp = "1700000000";
    const signature = sign('{"event":"meeting.started"}', timestamp);
    expect(verifyZoomSignature('{"event":"meeting.ended"}', timestamp, signature, SECRET)).toBe(false);
  });

  it("rejects a missing timestamp or signature header", () => {
    const rawBody = "{}";
    expect(verifyZoomSignature(rawBody, null, "v0=abc", SECRET)).toBe(false);
    expect(verifyZoomSignature(rawBody, "1700000000", null, SECRET)).toBe(false);
  });
});
