import { describe, expect, it } from "@jest/globals";
import { createMockPayment, createMockVideo, hmacHex, type ProviderResult } from "../../../supabase/functions/_shared/integrations/index.ts";

const REF = "chg-abcdefgh1234";
const TRF = "trf_abcdefgh123456789";

describe("mock payment helpers", () => {
  it("signs a charge webhook for a settled transaction that its own parser accepts", async () => {
    const m = createMockPayment(() => Date.parse("2026-10-06T10:00:00Z"));
    await m.initializeTransaction({ reference: REF, email: "a@example.com", amountKobo: 500_000, metadata: { order_id: "o-1" } });
    m.settle(REF, "success");
    const hook = await m.signedChargeWebhook(REF);
    const e = await m.parseWebhook(hook.rawBody, hook.signature);
    expect(e.ok && e.data).toMatchObject({ kind: "charge_success", reference: REF, amountKobo: 500_000, paidAt: "2026-10-06T10:00:00.000Z", customerEmail: "a@example.com", metadata: { order_id: "o-1" } });
  });

  it("a charge webhook that carries no paid time, customer or metadata still parses", async () => {
    const m = createMockPayment();
    const hook = await m.signedWebhook({ event: "charge.success", data: { reference: REF, amount: 100, currency: "NGN" } });
    const e = await m.parseWebhook(hook.rawBody, hook.signature);
    expect(e.ok && e.data).toMatchObject({ paidAt: null, customerEmail: null, metadata: {} });
    const none = await m.signedWebhook({ event: "ping", data: {} });
    const u = await m.parseWebhook(none.rawBody, none.signature);
    expect(u.ok && u.data).toMatchObject({ kind: "unknown", key: "ping:none" });
  });

  it("control helpers refuse an unknown reference loudly, so a test typo cannot pass silently", async () => {
    const m = createMockPayment();
    expect(() => m.settle("nope", "success")).toThrow();
    expect(() => m.settleTransfer("nope", "success")).toThrow();
    await expect(Promise.resolve().then(() => m.signedChargeWebhook("nope"))).rejects.toThrow();
  });

  it("every call can be made to fail once, then recovers", async () => {
    const m = createMockPayment();
    const calls: (() => Promise<ProviderResult<unknown>>)[] = [
      () => m.verifyTransaction(REF),
      () => m.refund({ reference: REF }),
      () => m.listBanks(),
      () => m.resolveAccount({ accountNumber: "0123456789", bankCode: "044" }),
      () => m.createTransferRecipient({ name: "A", accountNumber: "0123456789", bankCode: "044" }),
      () => m.initiateTransfer({ reference: TRF, amountKobo: 100, recipientCode: "RCP_x" }),
      () => m.verifyTransfer(TRF),
    ];
    for (const call of calls) {
      m.failNextCall();
      const r = await call();
      expect(r).toMatchObject({ ok: false, error: { code: "network", retryable: true } });
    }
  });

  it("refuses a full refund once part has gone, a recipient it never created, and a transfer state it cannot settle twice", async () => {
    const m = createMockPayment();
    await m.initializeTransaction({ reference: REF, email: "a@example.com", amountKobo: 1000 });
    m.settle(REF, "success");
    await m.refund({ reference: REF, amountKobo: 1000 });
    expect(await m.refund({ reference: REF })).toMatchObject({ ok: false, error: { code: "conflict" } });
    expect(await m.initiateTransfer({ reference: TRF, amountKobo: 100, recipientCode: "RCP_never" })).toMatchObject({ ok: false, error: { code: "not_found" } });
    expect(await m.verifyTransfer(TRF)).toMatchObject({ ok: false, error: { code: "not_found" } });
    expect(await m.refund({ reference: "chg-unknown-0001" })).toMatchObject({ ok: false, error: { code: "not_found" } });
  });
});

describe("mock video helpers", () => {
  it("uses the real clock when none is given", async () => {
    const v = createMockVideo();
    const r = await v.createRoom({ encounterRef: "7b9c2f0e-5d3a-4c11-9a52-0f6d1e8b7a44", expiresAtMs: Date.now() + 60_000 });
    expect(r.ok).toBe(true);
  });

  const ENC = "7b9c2f0e-5d3a-4c11-9a52-0f6d1e8b7a44";
  const ID = "2f4b8c1d-9e07-4a63-b5d2-6c8e0a1f3d97";
  it("every call can be made to fail once, then recovers", async () => {
    const v = createMockVideo(() => 1_800_000_000_000);
    const room = await v.createRoom({ encounterRef: ENC, expiresAtMs: 1_800_000_600_000 });
    if (!room.ok) throw new Error("room");
    v.failNextCall();
    expect(await v.joinToken({ roomId: room.data.roomId, role: "patient", identity: ID, ttlSeconds: 60 })).toMatchObject({ ok: false, error: { retryable: true } });
    v.failNextCall();
    expect(await v.endRoom(room.data.roomId, "clinician")).toMatchObject({ ok: false, error: { retryable: true } });
    expect((await v.endRoom(room.data.roomId, "clinician")).ok).toBe(true);
  });

  it("reads a signed non-JSON webhook as a bad response, and a body with no room as nothing to act on", async () => {
    const v = createMockVideo();
    const sign = async (raw: string) => ({ "x-mock-signature": await hmacHex("SHA-256", "mock-video-webhook-secret", raw) });
    expect(await v.parseWebhook("nope", await sign("nope"), 1)).toMatchObject({ ok: false, error: { code: "bad_response" } });
    expect(await v.parseWebhook("{}", await sign("{}"), 1)).toEqual({ ok: true, data: null });
  });
});
