// Provider event inbox branch of the Paystack webhook (S14x, flag `provider_inbox_paystack`).
// Run: deno test --no-config --allow-env=PAYSTACK_WEBHOOK_SECRET,TERMII_API_KEY,APP_BASE_URL inbox-branch.test.ts
// Same fake database as index.test.ts, with the inbox functions answered by an in-memory copy of the database rules.
import { assert, assertEquals } from "jsr:@std/assert@1";
import { handleWebhookRequest } from "./handler.ts";
import { outcomeOfResponse } from "./inbox-branch.ts";
import { FakeSupabaseClient } from "./test-fake-supabase.ts";
import { createMemoryInbox, type MemoryInbox } from "../../../packages/integrations/src/support/memory-inbox.ts";

const SECRET = "test-webhook-secret-do-not-use-in-prod";
Deno.env.set("PAYSTACK_WEBHOOK_SECRET", SECRET);

class InboxFake extends FakeSupabaseClient {
  constructor(readonly inbox: MemoryInbox, flag: "on" | "off" | null) {
    super({ payment_transactions: { uniqueOn: [["provider", "provider_event_id"]] } });
    if (flag) this.seed("feature_flags", [{ key: "provider_inbox_paystack", status: flag }]);
  }
  override async rpc(fn: string, args: Record<string, unknown>) {
    const ok = (data: unknown) => ({ data, error: null });
    const bad = (m: string) => ({ data: null, error: { message: m } });
    switch (fn) {
      case "record_provider_event": {
        const r = await this.inbox.record({ provider: args["p_provider"] as "paystack", eventType: String(args["p_event_type"]), idempotencyKey: String(args["p_idempotency_key"]), rawBody: String(args["p_raw_body"]), verified: args["p_verified"] === true });
        return r.ok ? ok({ id: r.data.id, status: r.data.status, duplicate: r.data.duplicate, verified: r.data.verified, body_differs: r.data.bodyDiffers }) : bad("record failed");
      }
      case "claim_provider_event": { const r = await this.inbox.claim(String(args["p_id"])); return r.ok ? ok(r.data) : bad("claim failed"); }
      case "complete_provider_event": { const r = await this.inbox.complete(String(args["p_id"]), String(args["p_lease"]), args["p_entity_type"] ? { type: String(args["p_entity_type"]), id: String(args["p_entity_id"]) } : undefined); return r.ok ? ok(r.data) : bad("x"); }
      case "fail_provider_event": { const r = await this.inbox.fail(String(args["p_id"]), String(args["p_lease"]), String(args["p_error"]), args["p_permanent"] === true); return r.ok ? ok(r.data) : bad("x"); }
      default: return super.rpc(fn, args);
    }
  }
}

async function sign(body: string): Promise<string> {
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(SECRET), { name: "HMAC", hash: "SHA-512" }, false, ["sign"]);
  return Array.from(new Uint8Array(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(body)))).map((b) => b.toString(16).padStart(2, "0")).join("");
}
async function post(client: InboxFake, body: unknown, signature?: string | null) {
  const raw = JSON.stringify(body);
  const headers = new Headers();
  const sig = signature === undefined ? await sign(raw) : signature;
  if (sig !== null) headers.set("x-paystack-signature", sig);
  // deno-lint-ignore no-explicit-any
  const res = await handleWebhookRequest(new Request("https://x.test/paystack-webhook", { method: "POST", headers, body: raw }), client as any);
  return { status: res.status, json: await res.json() as Record<string, unknown> };
}
const sub = (ref = "TXN_INBOX_1") => ({ event: "charge.success", data: { reference: ref, amount: 1500000, currency: "NGN", metadata: { kind: "subscription", profile_id: "p-1", item_code: "essential" } } });
const transfer = (event: string) => ({ event, data: { reference: "tpo-11111111222233334444555555555555-01", transfer_code: "TRF_abc", amount: 100 } });

Deno.test("flag off (or absent): the inbox is not touched and the old path answers", async () => {
  for (const flag of [null, "off"] as const) {
    const client = new InboxFake(createMemoryInbox(), flag);
    const out = await post(client, sub());
    assertEquals(out.json, { ok: true });
    assertEquals(client.inbox.rows.length, 0);
    assertEquals(client.rows("payment_transactions").length, 1);
    assertEquals((await post(client, sub(), "deadbeef")).json["error"], "invalid_signature");
    assertEquals(client.inbox.rows.length, 0);
  }
});

Deno.test("flag on: a verified event is stored first, then processed by the same code; a duplicate delivery is processed once", async () => {
  const client = new InboxFake(createMemoryInbox(), "on");
  assertEquals((await post(client, sub())).json, { ok: true });
  assertEquals((await post(client, sub())).json, { ok: true, replay: true });
  assertEquals((await post(client, sub())).json, { ok: true, replay: true });
  assertEquals(client.inbox.rows.length, 1);
  assertEquals(client.inbox.rows[0]?.status, "processed");
  assertEquals(client.inbox.rows[0]?.key, "charge.success:TXN_INBOX_1");
  assertEquals(client.inbox.rows[0]?.deliveries, 3);
  assertEquals(client.rows("payment_transactions").length, 1);
});

Deno.test("flag on: a bad signature is stored rejected, answered as the old path answers it, and nothing is processed", async () => {
  const client = new InboxFake(createMemoryInbox(), "on");
  const out = await post(client, sub(), "deadbeef");
  assertEquals(out.status, 200);
  assertEquals(out.json, { ok: false, error: "invalid_signature" });
  assertEquals(client.inbox.rows[0]?.status, "rejected");
  assertEquals(client.rows("payment_transactions").length, 0);
  const none = await post(client, sub(), null);
  assertEquals(none.json["error"], "invalid_signature");
});

Deno.test("flag on: out of order transfer events (reversed first) both reach the database, each stored under its own key", async () => {
  const client = new InboxFake(createMemoryInbox(), "on");
  await post(client, transfer("transfer.reversed"));
  await post(client, transfer("transfer.success"));
  assertEquals(client.rpcCalls.filter((c) => c.fn === "apply_payout_transfer_event").map((c) => c.args["p_event"]), ["transfer.reversed", "transfer.success"]);
  assertEquals(client.inbox.rows.map((r) => r.key), [
    "transfer.reversed:tpo-11111111222233334444555555555555-01",
    "transfer.success:tpo-11111111222233334444555555555555-01",
  ]);
  assertEquals(client.inbox.rows.every((r) => r.status === "processed"), true);
});

Deno.test("flag on: when the database refuses a transfer event the answer is 500, the inbox row is failed, and the redelivery is applied", async () => {
  const client = new InboxFake(createMemoryInbox(), "on");
  client.rpcResult = { data: null, error: { message: "db down" } };
  const first = await post(client, transfer("transfer.success"));
  assertEquals(first.status, 500);
  assertEquals(client.inbox.rows[0]?.status, "failed");
  client.rpcResult = { data: { result: "applied" }, error: null };
  const again = await post(client, transfer("transfer.success"));
  assertEquals(again.json, { ok: true });
  assertEquals(client.inbox.rows[0]?.status, "processed");
  assertEquals(client.rpcCalls.filter((c) => c.fn === "apply_payout_transfer_event").length, 2);
});

Deno.test("flag on: if the inbox cannot store the event the answer is 500 and nothing is processed (stored first, for money)", async () => {
  const inbox = createMemoryInbox();
  inbox.failNext("record");
  const client = new InboxFake(inbox, "on");
  const out = await post(client, sub());
  assertEquals(out.status, 500);
  assertEquals(out.json["error"], "inbox_unavailable");
  assertEquals(client.rows("payment_transactions").length, 0);
  // and the next delivery is stored and processed
  assertEquals((await post(client, sub())).json, { ok: true });
});

Deno.test("flag on: an unidentifiable refund is kept as a dead event and answered 200 as before; bad JSON signed correctly is dead too", async () => {
  const client = new InboxFake(createMemoryInbox(), "on");
  const refund = await post(client, { event: "refund.processed", data: { currency: "NGN" } });
  assertEquals(refund.status, 200);
  assertEquals(refund.json["error"], "refund_unidentifiable");
  assertEquals(client.inbox.rows[0]?.status, "dead");
  // a body that is signed but not JSON
  const raw = "not json at all";
  const headers = new Headers({ "x-paystack-signature": await sign(raw) });
  // deno-lint-ignore no-explicit-any
  const res = await handleWebhookRequest(new Request("https://x.test/paystack-webhook", { method: "POST", headers, body: raw }), client as any);
  assertEquals((await res.json()).error, "invalid_json");
  assertEquals(client.inbox.rows[1]?.status, "dead");
});

Deno.test("flag on: the order branch is reached through the inbox too, and its 500 (no Paystack key) leaves a failed event", async () => {
  const client = new InboxFake(createMemoryInbox(), "on");
  const order = { event: "charge.success", data: { reference: "tho_0123456789abcdef0123456789abcdef", amount: 500000, currency: "NGN", metadata: { kind: "order" } } };
  const out = await post(client, order);
  assertEquals(out.status, 500);
  assertEquals(client.inbox.rows[0]?.status, "failed");
});

Deno.test("a flag lookup that throws leaves the old path in charge", async () => {
  const client = new InboxFake(createMemoryInbox(), "on");
  const original = client.from.bind(client);
  // deno-lint-ignore no-explicit-any
  (client as any).from = (t: string) => { if (t === "feature_flags") throw new Error("boom"); return original(t); };
  assertEquals((await post(client, sub("TXN_FLAGLESS"))).json, { ok: true });
  assertEquals(client.inbox.rows.length, 0);
});

Deno.test("outcomeOfResponse: 5xx and explicit failure bodies are failures, a 200 success is ok", async () => {
  assertEquals(await outcomeOfResponse(new Response("x", { status: 502 })), { ok: false, error: "handler answered 502" });
  assertEquals(await outcomeOfResponse(Response.json({ ok: false })), { ok: false, error: "handler reported a failure", permanent: false });
  assertEquals(await outcomeOfResponse(Response.json({ ok: false, error: "record_failed" })), { ok: false, error: "record_failed", permanent: false });
  assertEquals(await outcomeOfResponse(Response.json({ ok: true })), { ok: true });
  assertEquals(await outcomeOfResponse(new Response("plain")), { ok: true });
  assert(true);
});

Deno.test("flag on: a redelivery of a DEAD event is answered 500, not acknowledged as a replay", async () => {
  const client = new InboxFake(createMemoryInbox(), "on");
  await post(client, { event: "refund.processed", data: { currency: "NGN" } }); // unidentifiable refund goes dead
  assertEquals(client.inbox.rows[0]?.status, "dead");
  const again = await post(client, { event: "refund.processed", data: { currency: "NGN" } });
  assertEquals(again.status, 500);
  assertEquals(again.json["error"], "event_dead");
});
