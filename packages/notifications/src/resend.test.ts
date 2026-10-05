import { describe, expect, it } from "@jest/globals";
import { createHmac } from "node:crypto";
import { mapResendEvent, verifySvix } from "./index.ts";

const SECRET_RAW = Buffer.from("s13-test-secret-bytes").toString("base64");
const SECRET = `whsec_${SECRET_RAW}`;
const sign = (id: string, ts: string, body: string) =>
  `v1,${createHmac("sha256", Buffer.from(SECRET_RAW, "base64")).update(`${id}.${ts}.${body}`).digest("base64")}`;
const NOW = Date.UTC(2026, 9, 6, 12, 0, 0);
const TS = String(NOW / 1000);

describe("verifySvix", () => {
  it("accepts a correct signature", async () => {
    expect(await verifySvix(SECRET, { id: "m1", timestamp: TS, signature: sign("m1", TS, "{}") }, "{}", NOW)).toBe(true);
  });
  it("accepts any one of several rotated signatures", async () => {
    expect(await verifySvix(SECRET, { id: "m1", timestamp: TS, signature: `v1,AAAA ${sign("m1", TS, "{}")}` }, "{}", NOW)).toBe(true);
  });
  it("rejects a changed body, a wrong secret, a missing header, a stale timestamp and a bad version", async () => {
    const good = sign("m1", TS, "{}");
    expect(await verifySvix(SECRET, { id: "m1", timestamp: TS, signature: good }, "{ }", NOW)).toBe(false);
    expect(await verifySvix(`whsec_${Buffer.from("other").toString("base64")}`, { id: "m1", timestamp: TS, signature: good }, "{}", NOW)).toBe(false);
    expect(await verifySvix(SECRET, { id: null, timestamp: TS, signature: good }, "{}", NOW)).toBe(false);
    expect(await verifySvix(SECRET, { id: "m1", timestamp: String(NOW / 1000 - 3600), signature: sign("m1", String(NOW / 1000 - 3600), "{}") }, "{}", NOW)).toBe(false);
    expect(await verifySvix(SECRET, { id: "m1", timestamp: "abc", signature: good }, "{}", NOW)).toBe(false);
    expect(await verifySvix(SECRET, { id: "m1", timestamp: TS, signature: good.replace("v1,", "v2,") }, "{}", NOW)).toBe(false);
    expect(await verifySvix(SECRET, { id: "m1", timestamp: TS, signature: "v1," }, "{}", NOW)).toBe(false);
    expect(await verifySvix(SECRET, { id: "m1", timestamp: TS, signature: "v1,short" }, "{}", NOW)).toBe(false);
  });
});

describe("mapResendEvent", () => {
  const e = (type: string, extra: object = {}) => ({ type, data: { email_id: "em1", to: ["Person@Example.com"], ...extra } });
  it("maps delivered, opened, complained, failed", () => {
    expect(mapResendEvent(e("email.delivered"))).toEqual({ event: "delivered", emailId: "em1", email: "person@example.com" });
    expect(mapResendEvent(e("email.opened"))?.event).toBe("opened");
    expect(mapResendEvent(e("email.complained"))?.event).toBe("complained");
    expect(mapResendEvent(e("email.failed"))?.event).toBe("failed");
  });
  it("only a permanent bounce suppresses", () => {
    expect(mapResendEvent(e("email.bounced", { bounce: { type: "Permanent" } }))?.event).toBe("bounced");
    expect(mapResendEvent(e("email.bounced", { bounce: { type: "Transient" } }))?.event).toBe("failed");
    expect(mapResendEvent(e("email.bounced"))?.event).toBe("failed");
  });
  it("ignores unknown types and events with no email id; tolerates no recipient", () => {
    expect(mapResendEvent(e("email.sent"))).toBeNull();
    expect(mapResendEvent({ type: "email.delivered", data: {} })).toBeNull();
    expect(mapResendEvent({ data: { email_id: "x" } })).toBeNull();
    expect(mapResendEvent({ type: "email.delivered", data: { email_id: "x" } })?.email).toBeNull();
  });
});
