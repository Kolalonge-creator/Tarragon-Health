import { describe, expect, it, jest } from "@jest/globals";
import { PermanentHandlerError, type BusEvent, type HandlerContext } from "./index";
import { makePartnerWebhookHandler, PARTNER_WEBHOOK_HANDLER_KEY } from "../../../supabase/functions/_shared/event-bus/partner-webhook-handler";
import { legacySignature, signatureV2, signedHeaders, verifyV2 } from "../../../supabase/functions/_shared/integrations/webhook-signature";

const ctx: HandlerContext = { once: async (_n, fn) => { await fn(); return true; } };
function ev(deliveryId: string): BusEvent {
  return {
    deliveryId, leaseToken: "l", attempt: 1, eventId: "e", eventType: "lab_result.released", eventVersion: 1, organisationId: "o",
    patientId: "p", aggregateType: "lab_result", aggregateId: "a", payload: { lab_result_id: "x" }, priority: "normal", isTest: true,
    occurredAt: "2026-10-13T00:00:00Z", subscriberKey: "partner.webhook.lab_result_released", handlerKey: PARTNER_WEBHOOK_HANDLER_KEY,
  };
}

describe("partner.webhook handler", () => {
  it("hands the delivery id to the database and nothing else", async () => {
    const enqueue = jest.fn(async (_id: string) => 2);
    await makePartnerWebhookHandler({ enqueue })(ev("d1"), ctx);
    expect(enqueue).toHaveBeenCalledWith("d1");
  });

  it("treats a removed mapping (-1) as done, not as an error", async () => {
    await expect(makePartnerWebhookHandler({ enqueue: async () => -1 })(ev("d1"), ctx)).resolves.toBeUndefined();
  });

  it("lets a database failure reach the bus so it is retried", async () => {
    const h = makePartnerWebhookHandler({ enqueue: async () => { throw new Error("boom"); } });
    await expect(h(ev("d1"), ctx)).rejects.toThrow("boom");
  });

  it("refuses a delivery with no id as permanent", async () => {
    const h = makePartnerWebhookHandler({ enqueue: async () => 1 });
    await expect(h(ev(""), ctx)).rejects.toBeInstanceOf(PermanentHandlerError);
  });
});

describe("webhook signatures", () => {
  const body = JSON.stringify({ event_id: "1" });
  const now = 1_790_000_000_000;

  it("keeps the legacy header unchanged", async () => {
    expect(await legacySignature("s".repeat(32), body)).toMatch(/^sha256=[0-9a-f]{64}$/);
  });

  it("signs the timestamp together with the body, so a replay with a new timestamp fails", async () => {
    const secret = "k".repeat(32);
    const h = await signedHeaders(secret, null, now, body);
    expect(h["X-Tarragon-Timestamp"]).toBe(String(now / 1000));
    expect(await verifyV2(h["X-Tarragon-Signature-V2"], [secret], body, now)).toBe(true);
    const forged = h["X-Tarragon-Signature-V2"].replace(/t=\d+/, `t=${now / 1000 + 1}`);
    expect(await verifyV2(forged, [secret], body, now)).toBe(false);
  });

  it("rejects a body change, a wrong key and a stale timestamp", async () => {
    const secret = "k".repeat(32);
    const h = await signedHeaders(secret, null, now, body);
    expect(await verifyV2(h["X-Tarragon-Signature-V2"], [secret], body + " ", now)).toBe(false);
    expect(await verifyV2(h["X-Tarragon-Signature-V2"], ["z".repeat(32)], body, now)).toBe(false);
    expect(await verifyV2(h["X-Tarragon-Signature-V2"], [secret], body, now + 301_000)).toBe(false);
    expect(await verifyV2("v1=abc", [secret], body, now)).toBe(false);
  });

  it("during a rotation both the new and the previous key verify", async () => {
    const oldKey = "o".repeat(32);
    const newKey = "n".repeat(32);
    const header = await signatureV2(newKey, oldKey, now / 1000, body);
    expect(header.match(/v1=/g)).toHaveLength(2);
    expect(await verifyV2(header, [oldKey], body, now)).toBe(true);
    expect(await verifyV2(header, [newKey], body, now)).toBe(true);
    expect(await verifyV2(await signatureV2(newKey, null, now / 1000, body), [oldKey], body, now)).toBe(false);
  });
});
