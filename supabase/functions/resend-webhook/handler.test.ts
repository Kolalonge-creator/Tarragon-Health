// Run: deno test --no-config .
import { assertEquals } from "jsr:@std/assert@1";
import { handleResendWebhook, type ResendDb } from "./handler.ts";
import { createMemoryInbox } from "../../../packages/integrations/src/support/memory-inbox.ts";
import { signSvixRaw } from "../../../packages/integrations/src/support/svix.ts";

const SECRET = "whsec_bW9jay1zZWNyZXQ="; // base64("mock-secret")
const NOW = 1_800_000_000_000;

function fakeDb(opts: { notification?: { id: string } | null; lookupError?: boolean; rpcError?: boolean } = {}) {
  const rpcCalls: { fn: string; args?: Record<string, unknown> }[] = [];
  const db = {
    from: () => ({ select: () => ({ eq: () => ({ maybeSingle: () => Promise.resolve({ data: opts.notification === undefined ? { id: "n-1" } : opts.notification, error: opts.lookupError ? { message: "x" } : null }) }) }) }),
    rpc: (fn: string, args?: Record<string, unknown>) => { rpcCalls.push({ fn, args }); return Promise.resolve({ data: null, error: opts.rpcError ? { message: "x" } : null }); },
  } as unknown as ResendDb;
  return { db, rpcCalls };
}

async function post(body: string, deps: Parameters<typeof handleResendWebhook>[1], sign = true, id = `msg_${NOW}`) {
  const s = await signSvixRaw(SECRET, body, NOW);
  const headers: Record<string, string> = sign ? { "svix-id": id, "svix-timestamp": s.headers.timestamp, "svix-signature": s.headers.signature } : { "svix-id": id, "svix-timestamp": s.headers.timestamp, "svix-signature": "v1,AAAA" };
  // svix signs with its own message id, so re-sign for the id we are sending
  if (sign && id !== s.headers.id) {
    const bin = atob(SECRET.replace(/^whsec_/, ""));
    const keyBytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) keyBytes[i] = bin.charCodeAt(i);
    const key = await crypto.subtle.importKey("raw", keyBytes, { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
    const sig = new Uint8Array(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(`${id}.${s.headers.timestamp}.${body}`)));
    headers["svix-signature"] = `v1,${btoa(String.fromCharCode(...sig))}`;
  }
  const res = await handleResendWebhook(new Request("https://x.test/resend-webhook", { method: "POST", headers, body }), deps);
  return { status: res.status, json: await res.json().catch(() => null) as Record<string, unknown> | null };
}

const delivered = JSON.stringify({ type: "email.delivered", data: { email_id: "em_1", to: ["a@example.com"] } });

Deno.test("method and configuration are checked first", async () => {
  const deps = { secret: SECRET, db: fakeDb().db, store: createMemoryInbox(), nowMs: () => NOW };
  assertEquals((await handleResendWebhook(new Request("https://x.test", { method: "GET" }), deps)).status, 405);
  assertEquals((await post(delivered, { ...deps, secret: null })).status, 503);
});

Deno.test("a signed event is stored in the inbox, recorded once, and a redelivery is not recorded again", async () => {
  const store = createMemoryInbox();
  const { db, rpcCalls } = fakeDb();
  const deps = { secret: SECRET, db, store, nowMs: () => NOW };
  assertEquals((await post(delivered, deps)).json, { recorded: true });
  assertEquals((await post(delivered, deps)).json, { duplicate: true });
  assertEquals(rpcCalls.length, 1);
  assertEquals(rpcCalls[0]?.args?.["p_event"], "delivered");
  assertEquals(store.rows.length, 1);
  assertEquals(store.rows[0]?.key, `svix:msg_${NOW}`);
  assertEquals(store.rows[0]?.status, "processed");
  assertEquals(store.rows[0]?.rawBody, delivered);
});

Deno.test("a bad signature is stored as rejected, answers 401 and records nothing", async () => {
  const store = createMemoryInbox();
  const { db, rpcCalls } = fakeDb();
  const out = await post(delivered, { secret: SECRET, db, store, nowMs: () => NOW }, false);
  assertEquals(out.status, 401);
  assertEquals(rpcCalls.length, 0);
  assertEquals(store.rows[0]?.status, "rejected");
  assertEquals(store.rows[0]?.verified, false);
});

Deno.test("an event we do not track, or a notification that is not ours, is acknowledged without recording", async () => {
  const { db, rpcCalls } = fakeDb({ notification: null });
  const deps = { secret: SECRET, db, store: createMemoryInbox(), nowMs: () => NOW };
  assertEquals((await post(delivered, deps, true, "msg_a")).json, { ignored: true });
  assertEquals((await post(JSON.stringify({ type: "email.sent", data: { email_id: "em_2" } }), deps, true, "msg_b")).json, { ignored: true });
  assertEquals(rpcCalls.length, 0);
});

Deno.test("a failed record is a 500 so Resend retries, the event waits in the inbox, and the redelivery records it", async () => {
  const store = createMemoryInbox();
  const broken = fakeDb({ rpcError: true });
  assertEquals((await post(delivered, { secret: SECRET, db: broken.db, store, nowMs: () => NOW })).status, 500);
  assertEquals(store.rows[0]?.status, "failed");
  const healthy = fakeDb();
  assertEquals((await post(delivered, { secret: SECRET, db: healthy.db, store, nowMs: () => NOW })).json, { recorded: true });
  assertEquals(healthy.rpcCalls.length, 1);
  assertEquals(store.rows[0]?.status, "processed");
  // a failed lookup is retried the same way
  assertEquals((await post(delivered, { secret: SECRET, db: fakeDb({ lookupError: true }).db, store: createMemoryInbox(), nowMs: () => NOW }, true, "msg_c")).status, 500);
});

Deno.test("a signed body that is not JSON answers 400 and is not retried", async () => {
  const store = createMemoryInbox();
  const out = await post("not json", { secret: SECRET, db: fakeDb().db, store, nowMs: () => NOW });
  assertEquals(out.status, 400);
  assertEquals(store.rows[0]?.status, "dead");
});

Deno.test("with the inbox unreachable the event is handled directly, as before the inbox existed", async () => {
  const store = createMemoryInbox();
  store.failNext("record");
  const { db, rpcCalls } = fakeDb();
  assertEquals((await post(delivered, { secret: SECRET, db, store, nowMs: () => NOW })).json, { recorded: true });
  assertEquals(rpcCalls.length, 1);
  // and with no store at all
  assertEquals((await post(delivered, { secret: SECRET, db: fakeDb().db, store: null, nowMs: () => NOW }, true, "msg_d")).json, { recorded: true });
  assertEquals((await post(delivered, { secret: SECRET, db: fakeDb().db, store: null, nowMs: () => NOW }, false)).status, 401);
  assertEquals((await post("not json", { secret: SECRET, db: fakeDb().db, store: null, nowMs: () => NOW }, true, "msg_e")).status, 400);
  assertEquals((await post(delivered, { secret: SECRET, db: fakeDb({ rpcError: true }).db, store: null, nowMs: () => NOW }, true, "msg_f")).status, 500);
  assertEquals((await post(JSON.stringify({ type: "email.sent", data: { email_id: "x" } }), { secret: SECRET, db: fakeDb().db, store: null, nowMs: () => NOW }, true, "msg_g")).json, { ignored: true });
});
