// Coverage for the auth Send SMS hook: signature gate, phone-keyed limit, retry, log hygiene (no phone, no code).
// Run: deno test --no-config supabase/functions/auth-send-sms-hook/handler.test.ts

import { assert, assertEquals, assertFalse } from "jsr:@std/assert@1";
import { handleHookRequest, MAX_SENDS_PER_HOUR, type SmsLogRow, type SmsLogStore } from "./handler.ts";
import { MockSmsProvider, buildOtpText } from "./provider.ts";

const RAW_SECRET = btoa("test-secret-not-for-prod-0123456789");
const SECRET = `v1,whsec_${RAW_SECRET}`;
const PEPPER = "test-pepper";
const NOW = 1_800_000_000;
const PHONE = "+2348031234567";
const OTP = "482913";

async function sign(body: string, id: string, ts: number): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    Uint8Array.from(atob(RAW_SECRET), (c) => c.charCodeAt(0)),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sig = new Uint8Array(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(`${id}.${ts}.${body}`)));
  return `v1,${btoa(String.fromCharCode(...sig))}`;
}

async function signedRequest(overrides: { body?: string; ts?: number; signature?: string; method?: string } = {}) {
  const body = overrides.body ?? JSON.stringify({ user: { id: "u-1", phone: PHONE }, sms: { otp: OTP } });
  const ts = overrides.ts ?? NOW;
  const signature = overrides.signature ?? (await sign(body, "msg_1", ts));
  return new Request("https://hook.test/", {
    method: overrides.method ?? "POST",
    headers: { "webhook-id": "msg_1", "webhook-timestamp": String(ts), "webhook-signature": signature },
    body: (overrides.method ?? "POST") === "POST" ? body : undefined,
  });
}

class MemoryStore implements SmsLogStore {
  rows: SmsLogRow[] = [];
  countOverride: number | null = null;
  failRead = false;
  countLastHour(_hash: string): Promise<number> {
    if (this.failRead) return Promise.reject(new Error("down"));
    return Promise.resolve(this.countOverride ?? this.rows.length);
  }
  insert(row: SmsLogRow): Promise<void> {
    this.rows.push(row);
    return Promise.resolve();
  }
}

function deps(provider = new MockSmsProvider(), store = new MemoryStore()) {
  return { provider, store, secret: SECRET, pepper: PEPPER, nowSeconds: () => NOW };
}

Deno.test("a validly signed request sends once and logs 'sent'", async () => {
  const d = deps();
  const res = await handleHookRequest(await signedRequest(), d);
  assertEquals(res.status, 200);
  assertEquals(d.provider.sent.length, 1);
  assertEquals(d.provider.sent[0].to, PHONE);
  assertEquals(d.store.rows.length, 1);
  assertEquals(d.store.rows[0].status, "sent");
});

Deno.test("message text is only the code and the brand name", () => {
  assertEquals(buildOtpText(OTP), "Your TarragonHealth code is 482913");
});

Deno.test("unsigned, wrongly signed and stale requests are refused and nothing is sent or logged", async () => {
  for (const make of [
    () => signedRequest({ signature: "v1,AAAA" }),
    () => signedRequest({ ts: NOW - 301 }),
    () => signedRequest({ ts: NOW + 301 }),
    () =>
      Promise.resolve(new Request("https://hook.test/", { method: "POST", body: "{}" })),
  ]) {
    const d = deps();
    const res = await handleHookRequest(await make(), d);
    assertEquals(res.status, 401);
    assertEquals(d.provider.sent.length, 0);
    assertEquals(d.store.rows.length, 0);
  }
});

Deno.test("a body tampered after signing is refused", async () => {
  const good = JSON.stringify({ user: { id: "u-1", phone: PHONE }, sms: { otp: OTP } });
  const sig = await sign(good, "msg_1", NOW);
  const d = deps();
  const res = await handleHookRequest(
    await signedRequest({ body: good.replace(PHONE, "+2348099999999"), signature: sig }),
    d,
  );
  assertEquals(res.status, 401);
  assertEquals(d.provider.sent.length, 0);
});

Deno.test("non-POST is refused; missing secret or pepper fails closed", async () => {
  assertEquals((await handleHookRequest(await signedRequest({ method: "GET" }), deps())).status, 405);
  const d = { ...deps(), secret: "" };
  assertEquals((await handleHookRequest(await signedRequest(), d)).status, 503);
  assertEquals(d.provider.sent.length, 0);
  const d2 = { ...deps(), pepper: "" };
  assertEquals((await handleHookRequest(await signedRequest(), d2)).status, 503);
});

Deno.test("the phone-keyed limit refuses the sixth send in an hour and logs rate_limited", async () => {
  const d = deps();
  d.store.countOverride = MAX_SENDS_PER_HOUR;
  const res = await handleHookRequest(await signedRequest(), d);
  assertEquals(res.status, 429);
  assertEquals(d.provider.sent.length, 0);
  assertEquals(d.store.rows[0].status, "rate_limited");

  const ok = deps();
  ok.store.countOverride = MAX_SENDS_PER_HOUR - 1;
  assertEquals((await handleHookRequest(await signedRequest(), ok)).status, 200);
});

Deno.test("an unreadable log fails closed (no send)", async () => {
  const d = deps();
  d.store.failRead = true;
  const res = await handleHookRequest(await signedRequest(), d);
  assertEquals(res.status, 503);
  assertEquals(d.provider.sent.length, 0);
});

Deno.test("a retryable failure is retried once and then succeeds", async () => {
  const provider = new MockSmsProvider([{ ok: false, retryable: true, code: "timeout" }]);
  const d = deps(provider);
  const res = await handleHookRequest(await signedRequest(), d);
  assertEquals(res.status, 200);
  assertEquals(provider.sent.length, 2);
  assertEquals(d.store.rows[0].attempts, 2);
  assertEquals(d.store.rows[0].status, "sent");
});

Deno.test("a persistent or non-retryable failure returns 502 and is logged failed", async () => {
  const p1 = new MockSmsProvider([
    { ok: false, retryable: true, code: "timeout" },
    { ok: false, retryable: true, code: "timeout" },
  ]);
  const d1 = deps(p1);
  assertEquals((await handleHookRequest(await signedRequest(), d1)).status, 502);
  assertEquals(p1.sent.length, 2);
  assertEquals(d1.store.rows[0].status, "failed");

  const p2 = new MockSmsProvider([{ ok: false, retryable: false, code: "http_400" }]);
  const d2 = deps(p2);
  assertEquals((await handleHookRequest(await signedRequest(), d2)).status, 502);
  assertEquals(p2.sent.length, 1);
});

Deno.test("the log row and every response carry neither the phone number nor the code", async () => {
  const d = deps();
  const res = await handleHookRequest(await signedRequest(), d);
  const ok = JSON.stringify(d.store.rows) + (await res.text());
  assertFalse(ok.includes(PHONE));
  assertFalse(ok.includes("8031234567"));
  assertFalse(ok.includes(OTP));
  assert(d.store.rows[0].phoneHash.length === 64);

  const limited = deps();
  limited.store.countOverride = MAX_SENDS_PER_HOUR;
  const r2 = await handleHookRequest(await signedRequest(), limited);
  const blob = JSON.stringify(limited.store.rows) + (await r2.text());
  assertFalse(blob.includes(PHONE));
  assertFalse(blob.includes(OTP));
});

Deno.test("invalid payloads are refused before anything is sent", async () => {
  for (const body of [
    JSON.stringify({ user: { phone: "0803" }, sms: { otp: OTP } }),
    JSON.stringify({ user: { phone: PHONE }, sms: { otp: "abc" } }),
    "not json",
  ]) {
    const d = deps();
    const res = await handleHookRequest(await signedRequest({ body }), d);
    assert(res.status === 400);
    assertEquals(d.provider.sent.length, 0);
  }
});
