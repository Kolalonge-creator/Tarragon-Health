import { describe, expect, it } from "@jest/globals";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import {
  createPaystackPayment,
  createResendEmail,
  createZoomVideo,
  hmacHex,
  isSafeWebhookChallenge,
  paystackEventKey,
  readCappedBody,
  resendEventKey,
  zoomEventKey,
  type FetchLike,
  type VideoEvent,
} from "../../../supabase/functions/_shared/integrations/index.ts";
import { signSvixRaw } from "./support/svix.ts";

/**
 * Recorded-fixture contract tests for the three live vendor adapters. Every payload in ./fixtures is written from the vendor's PUBLISHED
 * reference shape (field names and nesting), never captured from a live account, because none exists yet: the sandbox check
 * (scripts/provider-sandbox-check.mjs) is what proves these shapes against the real vendor. Each vendor gets the same set of cases:
 * a good event, a forged signature, a replay outside the window, out of order, duplicate, malformed and oversize.
 */
const fx = (path: string): string => readFileSync(fileURLToPath(new URL(`./fixtures/${path}`, import.meta.url)), "utf8");
const NOW = 1_800_000_000_000;
const noFetch: FetchLike = async () => ({ status: 200, ok: true, text: async () => "{}" });

describe("Zoom webhooks (adapter parseWebhook)", () => {
  const SECRET = "zoom-secret-token";
  const zoom = createZoomVideo({ accountId: "a", clientId: "c", clientSecret: "s", webhookSecretToken: SECRET, fetch: noFetch });
  const sign = async (raw: string, ts = String(Math.floor(NOW / 1000))) => ({ "x-zm-request-timestamp": ts, "x-zm-signature": `v0=${await hmacHex("SHA-256", SECRET, `v0:${ts}:${raw}`)}` });
  const parse = async (name: string, at = NOW): Promise<ReturnType<typeof zoom.parseWebhook>> => zoom.parseWebhook(fx(`zoom/${name}`), await sign(fx(`zoom/${name}`)), at);
  const event = async (name: string): Promise<VideoEvent | null> => {
    const r = await parse(name);
    if (!r.ok) throw new Error(r.error.code);
    return r.data;
  };

  it("maps a participant joining with the key we issued", async () => {
    expect(await event("participant-joined.json")).toEqual({ kind: "participant_joined", roomId: "81000000001", role: "patient", atMs: 1800000001000, customerKey: "5b0c8d4e-3f50-4f0a-9d1e-7a6d2b9e1c11" });
  });
  it("counts the waiting room as arrived, and a leaving participant as left", async () => {
    expect(await event("participant-joined-waiting-room.json")).toMatchObject({ kind: "participant_joined", role: "clinician" });
    expect(await event("participant-left.json")).toMatchObject({ kind: "participant_left", role: "patient" });
  });
  it("gives a phone caller no role and no key (nothing to verify, so nothing is claimed)", async () => {
    expect(await event("participant-joined-by-phone.json")).toBeNull();
  });
  it("maps the meeting ending, and ignores the url validation challenge as a room event", async () => {
    expect(await event("meeting-ended.json")).toEqual({ kind: "room_ended", roomId: "81000000001", atMs: 1626230691572 });
    expect(await event("endpoint-url-validation.json")).toBeNull();
  });
  it("refuses a forged signature, a missing header, and a body changed after signing", async () => {
    const raw = fx("zoom/meeting-ended.json");
    const good = await sign(raw);
    const variants: Record<string, string>[] = [{ ...good, "x-zm-signature": "v0=" + "0".repeat(64) }, { "x-zm-request-timestamp": good["x-zm-request-timestamp"] }, { "x-zm-signature": good["x-zm-signature"] }, {}];
    for (const headers of variants) {
      const r = await zoom.parseWebhook(raw, headers, NOW);
      expect(r.ok === false && r.error.code).toBe("invalid_signature");
    }
    const tampered = await zoom.parseWebhook(raw.replace("81000000001", "81000000002"), good, NOW);
    expect(tampered.ok === false && tampered.error.code).toBe("invalid_signature");
  });
  it("refuses a signed request outside five minutes either way as stale (so a captured one cannot be replayed), at the exact edge it passes", async () => {
    const raw = fx("zoom/meeting-ended.json");
    const h = await sign(raw);
    for (const at of [NOW + 300_001, NOW - 300_001]) {
      const r = await zoom.parseWebhook(raw, h, at);
      expect(r.ok === false && r.error.code).toBe("stale_event");
    }
    expect((await zoom.parseWebhook(raw, h, NOW + 300_000)).ok).toBe(true);
    const odd = await zoom.parseWebhook(raw, await sign(raw, "1e9"), NOW);
    expect(odd.ok === false && odd.error.code).toBe("invalid_signature");
  });
  it("is the same answer when the same signed request arrives twice, and each event keeps its own order-independent key", async () => {
    const once = await parse("participant-left.json");
    const twice = await parse("participant-left.json");
    expect(twice).toEqual(once);
    const left = await zoomEventKey(fx("zoom/participant-left.json"));
    const joined = await zoomEventKey(fx("zoom/participant-joined.json"));
    expect(left.idempotencyKey).not.toBe(joined.idempotencyKey);
    expect((await zoomEventKey(fx("zoom/participant-left.json"))).idempotencyKey).toBe(left.idempotencyKey);
    // out of order: the left event parses on its own without the joined one ever having been seen
    expect(await event("participant-left.json")).toMatchObject({ kind: "participant_left" });
  });
  it("answers a signed body that is not JSON as a bad reply, and an unrecognised shape as nothing to do", async () => {
    const junk = "{not json";
    const r = await zoom.parseWebhook(junk, await sign(junk), NOW);
    expect(r.ok === false && r.error.code).toBe("bad_response");
    const odd = '{"event":"meeting.started"}';
    const n = await zoom.parseWebhook(odd, await sign(odd), NOW);
    expect(n.ok && n.data).toBeNull();
  });
  it("hashes a body with no identifiers into the key instead of colliding on a blank one", async () => {
    const a = await zoomEventKey('{"event":"x"}');
    const b = await zoomEventKey('{"event":"y"}');
    expect(a.idempotencyKey).toMatch(/sha256/);
    expect(a.idempotencyKey).not.toBe(b.idempotencyKey);
  });
  it("only echoes a challenge that is a plain token (the answer is an oracle for the signing secret otherwise)", () => {
    const plain = (JSON.parse(fx("zoom/endpoint-url-validation.json")) as { payload: { plainToken: string } }).payload.plainToken;
    expect(isSafeWebhookChallenge(plain)).toBe(true);
    expect(isSafeWebhookChallenge("v0:1800000000:{\"event\":\"meeting.ended\"}")).toBe(false);
    expect(isSafeWebhookChallenge("a b")).toBe(false);
    expect(isSafeWebhookChallenge("x".repeat(257))).toBe(false);
    expect(isSafeWebhookChallenge(5)).toBe(false);
  });
});

describe("Zoom REST replies", () => {
  it("reads the documented meeting reply for a clinician and a patient, and Nigerian dial-in numbers only", async () => {
    const reply = fx("zoom/meeting-get.json");
    const parsed = JSON.parse(reply) as Record<string, unknown>;
    const fixedNow = Date.parse(parsed["start_time"] as string) + 60_000;
    const f: FetchLike = async (url) => ({ status: 200, ok: true, text: async () => (url.includes("oauth") ? '{"access_token":"t","expires_in":3599}' : url.includes("/token?") ? '{"token":"zakvalue"}' : reply) });
    const z = createZoomVideo({ accountId: "a", clientId: "c", clientSecret: "s", sdkKey: "k", sdkSecret: "x", hostUserId: "consult-host@tarragonhealth.ng", fetch: f, now: () => fixedNow });
    const clin = await z.joinLink({ roomId: "81000000001", role: "clinician", mediaMode: "video" });
    expect(clin.ok && clin.data.url).toContain("/s/");
    const pat = await z.joinLink({ roomId: "81000000001", role: "patient", mediaMode: "audio_only" });
    expect(pat.ok && pat.data.url).toContain("/j/");
    const dial = await z.dialIn({ roomId: "81000000001", country: "NG" });
    expect(dial.ok && dial.data.numbers.map((n) => n.kind)).toEqual(["toll", "toll_free"]);
    expect(dial.ok && dial.data.passcode).toBe("482913");
    const tok = await z.joinToken({ roomId: "81000000001", identity: "5b0c8d4e-3f50-4f0a-9d1e-7a6d2b9e1c11", role: "clinician", ttlSeconds: 600 });
    expect(tok.ok && tok.data.zak).toBe("zakvalue");
  });
  it("sends a start_time Zoom's documented format accepts (no milliseconds)", async () => {
    const seen: string[] = [];
    const f: FetchLike = async (url, init) => {
      if (url.includes("oauth")) return { status: 200, ok: true, text: async () => '{"access_token":"t","expires_in":3599}' };
      seen.push(String((JSON.parse(init.body ?? "{}") as { start_time?: string }).start_time));
      return { status: 201, ok: true, text: async () => '{"id":81000000001}' };
    };
    const z = createZoomVideo({ accountId: "a", clientId: "c", clientSecret: "s", hostUserId: "host@example.test", fetch: f, now: () => NOW + 123 });
    await z.createRoom({ encounterRef: "5b0c8d4e-3f50-4f0a-9d1e-7a6d2b9e1c11", expiresAtMs: NOW + 1_800_000 });
    expect(seen[0]).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/);
  });
});

describe("Paystack webhooks and replies (adapter)", () => {
  const SECRET = "sk_test_fixture";
  const pay = createPaystackPayment({ secretKey: SECRET, fetch: noFetch });
  const sig = (raw: string) => hmacHex("SHA-512", SECRET, raw);
  const parse = async (name: string) => pay.parseWebhook(fx(`paystack/${name}`), await sig(fx(`paystack/${name}`)));

  it("maps charge.success with the fee and requested amount split", async () => {
    const r = await parse("charge-success.json");
    expect(r.ok && r.data).toMatchObject({ kind: "charge_success", reference: "ord_8f1c2a9e", amountKobo: 150000, requestedAmountKobo: 150000, feesKobo: 2250, currency: "NGN", customerEmail: "patient@example.com" });
  });
  it("maps the three transfer outcomes, each with a key of its own so a reversal after a success is not dropped as a replay", async () => {
    const kinds = [];
    for (const n of ["success", "failed", "reversed"]) {
      const r = await parse(`transfer-${n}.json`);
      expect(r.ok && r.data).toMatchObject({ kind: "transfer", status: n, transferCode: "TRF_wpl1dem4967avzm", reference: "payout-0001-attempt-1-abcd" });
      kinds.push((await paystackEventKey(fx(`paystack/transfer-${n}.json`))).idempotencyKey);
    }
    expect(new Set(kinds).size).toBe(3);
  });
  it("maps a refund by the charge it belongs to and keys it with the amount", async () => {
    const r = await parse("refund-processed.json");
    expect(r.ok && r.data).toMatchObject({ kind: "refund", status: "processed" });
    expect((await paystackEventKey(fx("paystack/refund-processed.json"))).idempotencyKey).toBe("refund.processed:ord_8f1c2a9e:150000");
  });
  it("passes an event it does not know through as unknown instead of failing", async () => {
    const r = await parse("unknown-event.json");
    expect(r.ok && r.data.kind).toBe("unknown");
  });
  it("is the same answer and the same key when the same event arrives twice", async () => {
    expect(await parse("charge-success.json")).toEqual(await parse("charge-success.json"));
    expect((await paystackEventKey(fx("paystack/charge-success.json"))).idempotencyKey).toBe("charge.success:ord_8f1c2a9e");
  });
  it("refuses a missing, forged, wrong-key or tampered signature, and accepts an upper case hex digest", async () => {
    const raw = fx("paystack/charge-success.json");
    for (const bad of [null, "", "0".repeat(128), await hmacHex("SHA-512", "sk_test_other", raw)]) {
      const r = await pay.parseWebhook(raw, bad);
      expect(r.ok === false && r.error.code).toBe("invalid_signature");
    }
    const tampered = await pay.parseWebhook(raw.replace("150000", "1"), await sig(raw));
    expect(tampered.ok === false && tampered.error.code).toBe("invalid_signature");
    expect((await pay.parseWebhook(raw, (await sig(raw)).toUpperCase())).ok).toBe(true);
  });
  it("rejects a signed body that is not JSON, or has no event or no data", async () => {
    for (const raw of ["{nope", "[]", '{"event":"charge.success"}', '{"data":{}}']) {
      const r = await pay.parseWebhook(raw, await sig(raw));
      expect(r.ok === false && r.error.code).toBe("bad_response");
    }
  });
  it("keys an event with no reference by id, and one with nothing at all by its body hash", async () => {
    expect((await paystackEventKey('{"event":"subscription.create","data":{"subscription_code":"SUB_x"}}')).idempotencyKey).toBe("subscription.create:SUB_x");
    expect((await paystackEventKey('{"event":"x","data":{}}')).idempotencyKey).toMatch(/^x:sha256:/);
    expect((await paystackEventKey("not json")).eventType).toBe("unknown");
  });
  it("reads the documented transfer reply as pending and a reused reference as a conflict (verify, do not retry)", async () => {
    const mk = (status: number, body: string) => createPaystackPayment({ secretKey: SECRET, fetch: async () => ({ status, ok: status < 300, text: async () => body }) });
    const ok = await mk(200, fx("paystack/transfer-initiate.json")).initiateTransfer({ reference: "payout-0001-attempt-1-abcd", amountKobo: 500000, recipientCode: "RCP_a8wkxiychzdzfgs" });
    expect(ok.ok && ok.data).toEqual({ transferCode: "TRF_wpl1dem4967avzm", reference: "payout-0001-attempt-1-abcd", amountKobo: 500000, status: "pending" });
    const dup = await mk(400, fx("paystack/transfer-duplicate-reference.json")).initiateTransfer({ reference: "payout-0001-attempt-1-abcd", amountKobo: 500000, recipientCode: "RCP_a8wkxiychzdzfgs" });
    expect(dup.ok === false && dup.error).toMatchObject({ code: "conflict", retryable: false });
  });
  it("reads the documented settlement list and settlement transactions", async () => {
    const f: FetchLike = async (url) => ({ status: 200, ok: true, text: async () => fx(url.includes("/transactions") ? "paystack/settlement-transactions.json" : "paystack/settlement-list.json") });
    const p = createPaystackPayment({ secretKey: SECRET, fetch: f });
    const list = await p.listSettlements({});
    expect(list.ok && list.data).toEqual({ items: [{ settlementId: "1111111", status: "success", totalKobo: 14775000, feesKobo: 225000, settledAt: "2027-01-16T00:00:00.000Z" }], hasMore: false });
    const txs = await p.listSettlementTransactions("1111111");
    expect(txs.ok && txs.data.items[0]).toEqual({ reference: "ord_8f1c2a9e", amountKobo: 150000, feesKobo: 2250, status: "success", paidAt: "2027-01-15T08:00:12.000Z" });
  });
});

describe("Resend webhooks (Svix) and sends", () => {
  const SECRET = "whsec_cmVzZW5kLXRlc3Q="; // base64("resend-test")
  const mail = createResendEmail({ apiKey: "re_test", from: "x <a@example.com>", webhookSecret: SECRET, fetch: noFetch });
  const signed = (name: string, at = NOW) => signSvixRaw(SECRET, fx(`resend/${name}`), at);
  const parse = async (name: string) => {
    const s = await signed(name);
    return mail.parseWebhook(s.rawBody, s.headers, NOW);
  };

  it("maps delivered, a permanent bounce, a complaint and a failure", async () => {
    expect((await parse("email-delivered.json")).ok).toBe(true);
    expect(await parse("email-delivered.json")).toMatchObject({ ok: true, data: { event: "delivered", email: "patient@example.com" } });
    expect(await parse("email-bounced-permanent.json")).toMatchObject({ ok: true, data: { event: "bounced" } });
    expect(await parse("email-complained.json")).toMatchObject({ ok: true, data: { event: "complained" } });
    expect(await parse("email-failed.json")).toMatchObject({ ok: true, data: { event: "failed" } });
  });
  it("treats a transient bounce as a failure to retry, not a reason to suppress the address", async () => {
    expect(await parse("email-bounced-transient.json")).toMatchObject({ ok: true, data: { event: "failed" } });
  });
  it("acknowledges an event type it does not track as nothing to do", async () => {
    const r = await parse("email-delivery-delayed.json");
    expect(r.ok && r.data).toBeNull();
  });
  it("refuses a forged signature, a missing header, and a tampered body", async () => {
    const s = await signed("email-delivered.json");
    for (const headers of [{ ...s.headers, signature: "v1,AAAA" }, { ...s.headers, id: null }, { ...s.headers, timestamp: null }, { ...s.headers, signature: null }, { ...s.headers, signature: "v2," + s.headers.signature.slice(3) }]) {
      const r = await mail.parseWebhook(s.rawBody, headers as never, NOW);
      expect(r.ok === false && r.error.code).toBe("invalid_signature");
    }
    const t = await mail.parseWebhook(s.rawBody.replace("delivered", "complained"), s.headers, NOW);
    expect(t.ok === false && t.error.code).toBe("invalid_signature");
  });
  it("refuses a replay outside five minutes either way, and a timestamp that is not whole seconds", async () => {
    const s = await signed("email-delivered.json");
    for (const at of [NOW + 301_000, NOW - 301_000]) {
      const r = await mail.parseWebhook(s.rawBody, s.headers, at);
      expect(r.ok === false && r.error.code).toBe("invalid_signature");
    }
    const sci = await mail.parseWebhook(s.rawBody, { ...s.headers, timestamp: "1.8e9" }, NOW);
    expect(sci.ok === false && sci.error.code).toBe("invalid_signature");
  });
  it("accepts either of two signatures during a secret rotation", async () => {
    const s = await signed("email-delivered.json");
    const rotated = { ...s.headers, signature: `v1,AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA= ${s.headers.signature}` };
    expect((await mail.parseWebhook(s.rawBody, rotated, NOW)).ok).toBe(true);
  });
  it("keys a delivery by the Svix message id so a redelivery is one event, and falls back on a hash when the header is missing", async () => {
    const raw = fx("resend/email-delivered.json");
    expect((await resendEventKey(raw, "msg_abc")).idempotencyKey).toBe("svix:msg_abc");
    expect((await resendEventKey(raw, null)).idempotencyKey).toMatch(/^email\.delivered:sha256:/);
    expect((await resendEventKey("not json", null)).eventType).toBe("unknown");
  });
});

describe("oversize bodies are refused before any signature work", () => {
  const post = (body: string, headers: Record<string, string> = {}) => new Request("https://x.test/hook", { method: "POST", body, headers });
  it("takes a normal body and an empty one", async () => {
    expect(await readCappedBody(post(fx("paystack/charge-success.json")))).toEqual({ ok: true, body: fx("paystack/charge-success.json") });
    expect(await readCappedBody(new Request("https://x.test/hook", { method: "POST" }))).toEqual({ ok: true, body: "" });
  });
  it("refuses a body over the cap, whether or not the length is declared", async () => {
    const big = "x".repeat(1_048_577);
    expect(await readCappedBody(post(big))).toEqual({ ok: false });
    expect(await readCappedBody(post("tiny", { "content-length": "99999999" }))).toEqual({ ok: false });
    const stream = new ReadableStream<Uint8Array>({ start(c) { c.enqueue(new Uint8Array(600)); c.enqueue(new Uint8Array(600)); c.close(); } });
    const noHeader = new Request("https://x.test/hook", { method: "POST", body: stream, duplex: "half" } as RequestInit);
    expect(await readCappedBody(noHeader, 1000)).toEqual({ ok: false });
  });
});
