import { describe, expect, it } from "@jest/globals";
import {
  drainInbox, paystackEventKey, receiveProviderEvent, resendEventKey, supabaseInboxStore, zoomEventKey,
  type Dispatch, type InboundEvent, type InboxProvider,
} from "../../../supabase/functions/_shared/integrations/index.ts";
import { createMemoryInbox } from "./support/memory-inbox";

const charge = (ref: string) => JSON.stringify({ event: "charge.success", data: { reference: ref, amount: 500_000 } });
const derivePaystack = (body: string) => () => paystackEventKey(body);
const recv = (store: ReturnType<typeof createMemoryInbox>, body: string, verified: boolean, dispatch: Dispatch, provider: InboxProvider = "paystack") =>
  receiveProviderEvent(store, { provider, rawBody: body, verified, derive: derivePaystack(body) }, dispatch);

function counting(): { dispatch: Dispatch; seen: InboundEvent[] } {
  const seen: InboundEvent[] = [];
  return { seen, dispatch: async (e) => { seen.push(e); return { ok: true, entity: { type: "order", id: "o-1" } }; } };
}

describe("receiveProviderEvent", () => {
  it("stores a verified event, dispatches it once and links the entity", async () => {
    const store = createMemoryInbox();
    const { dispatch, seen } = counting();
    const out = await recv(store, charge("REF-1"), true, dispatch);
    expect(out).toMatchObject({ kind: "processed", entity: { type: "order", id: "o-1" } });
    expect(seen).toHaveLength(1);
    expect(seen[0]).toMatchObject({ provider: "paystack", eventType: "charge.success", idempotencyKey: "charge.success:REF-1" });
    expect(store.rows[0]).toMatchObject({ status: "processed", verified: true, entity: "order:o-1" });
    expect(store.rows[0]?.rawBody).toBe(charge("REF-1"));
  });

  it("processes a duplicate delivery once, however many times Paystack sends it", async () => {
    const store = createMemoryInbox();
    const { dispatch, seen } = counting();
    const first = await recv(store, charge("REF-2"), true, dispatch);
    const second = await recv(store, charge("REF-2"), true, dispatch);
    const third = await recv(store, charge("REF-2"), true, dispatch);
    expect(first.kind).toBe("processed");
    expect([second.kind, third.kind]).toEqual(["duplicate", "duplicate"]);
    expect(seen).toHaveLength(1);
    expect(store.rows).toHaveLength(1);
    expect(store.rows[0]?.deliveries).toBe(3);
  });

  it("does not run an event twice while the first delivery is still being handled", async () => {
    const store = createMemoryInbox();
    let release: () => void = () => undefined;
    const slow: Dispatch = () => new Promise((resolve) => { release = () => resolve({ ok: true }); });
    const { dispatch, seen } = counting();
    const inFlight = recv(store, charge("REF-3"), true, slow);
    await Promise.resolve();
    await new Promise((r) => setTimeout(r, 0));
    const concurrent = await recv(store, charge("REF-3"), true, dispatch);
    expect(concurrent).toMatchObject({ kind: "duplicate", status: "processing" });
    release();
    expect((await inFlight).kind).toBe("processed");
    expect(seen).toHaveLength(0);
  });

  it("stores a bad signature as rejected and never dispatches, claims, retries or replays it", async () => {
    const store = createMemoryInbox();
    const { dispatch, seen } = counting();
    const out = await recv(store, charge("FORGED"), false, dispatch);
    expect(out.kind).toBe("rejected");
    expect(seen).toHaveLength(0);
    expect(store.rows[0]).toMatchObject({ status: "rejected", verified: false });
    expect(store.rows[0]?.key).toMatch(/^unverified:[0-9a-f]{64}$/);
    // the same forged body again is one row, a different forged body is another
    await recv(store, charge("FORGED"), false, dispatch);
    await recv(store, charge("FORGED-2"), false, dispatch);
    expect(store.rows).toHaveLength(2);
    expect(store.rows[0]?.deliveries).toBe(2);
    expect(await store.claim(store.rows[0]!.id)).toEqual({ ok: true, data: null });
    expect(store.replay(store.rows[0]!.id)).toBe(false);
    const drained = await drainInbox(store, { paystack: dispatch, zoom: dispatch, resend: dispatch });
    expect(drained).toEqual({ ok: true, data: { processed: 0, failed: 0 } });
    expect(seen).toHaveLength(0);
  });

  it("a forged event cannot occupy the key of a real one", async () => {
    const store = createMemoryInbox();
    const { dispatch, seen } = counting();
    await recv(store, charge("REAL-1"), false, dispatch); // forged first, claiming the real reference
    const real = await recv(store, charge("REAL-1"), true, dispatch);
    expect(real.kind).toBe("processed");
    expect(seen).toHaveLength(1);
  });

  it("keeps a rejected row even when the store is down for it, and still answers rejected", async () => {
    const store = createMemoryInbox();
    store.failNext("record");
    const out = await recv(store, charge("X"), false, counting().dispatch);
    expect(out).toEqual({ kind: "rejected", id: null });
  });

  it("answers store_unavailable when a verified event cannot be recorded or claimed, and runs nothing", async () => {
    const store = createMemoryInbox();
    const { dispatch, seen } = counting();
    store.failNext("record");
    expect((await recv(store, charge("A"), true, dispatch)).kind).toBe("store_unavailable");
    store.failNext("claim");
    expect((await recv(store, charge("B"), true, dispatch)).kind).toBe("store_unavailable");
    expect(seen).toHaveLength(0);
  });

  it("a failed dispatch is recorded with its error and a redelivery is itself the retry", async () => {
    const store = createMemoryInbox();
    let calls = 0;
    const flaky: Dispatch = async () => (++calls === 1 ? { ok: false, error: "database busy" } : { ok: true });
    const first = await recv(store, charge("REF-4"), true, flaky);
    expect(first).toMatchObject({ kind: "failed", error: "database busy", status: "failed" });
    expect(store.rows[0]).toMatchObject({ status: "failed", lastError: "database busy", attempts: 1 });
    const again = await recv(store, charge("REF-4"), true, flaky);
    expect(again.kind).toBe("processed");
    expect(store.rows[0]).toMatchObject({ status: "processed", attempts: 2 });
    expect(calls).toBe(2);
  });

  it("a handler that throws is a retryable failure, with a short message and no body", async () => {
    const store = createMemoryInbox();
    const boom = await recv(store, charge("REF-5"), true, async () => { throw new Error("connection reset"); });
    expect(boom).toMatchObject({ kind: "failed", error: "connection reset" });
    const odd = await recv(store, charge("REF-6"), true, async () => { throw "nope"; });
    expect(odd).toMatchObject({ kind: "failed", error: "handler threw" });
  });

  it("a permanent failure goes dead and is never run again", async () => {
    const store = createMemoryInbox();
    const out = await recv(store, charge("REF-7"), true, async () => ({ ok: false, error: "no such order", permanent: true }));
    expect(out).toMatchObject({ kind: "failed", status: "dead" });
    const { dispatch, seen } = counting();
    store.advance(10_000_000);
    expect((await recv(store, charge("REF-7"), true, dispatch)).kind).toBe("duplicate");
    expect(await drainInbox(store, { paystack: dispatch, zoom: dispatch, resend: dispatch })).toEqual({ ok: true, data: { processed: 0, failed: 0 } });
    expect(seen).toHaveLength(0);
  });

  it("reports an unknown status when the failure could not be recorded", async () => {
    const store = createMemoryInbox();
    store.failNext("fail");
    const out = await recv(store, charge("REF-8"), true, async () => ({ ok: false, error: "x" }));
    expect(out).toMatchObject({ kind: "failed", status: "unknown" });
  });

  it("a completion that cannot be recorded still counts as processed; the leased event is retried by a handler safe to run twice", async () => {
    const store = createMemoryInbox();
    store.failNext("complete");
    const effects = new Set<string>();
    const idem: Dispatch = async (e) => { effects.add(e.idempotencyKey); return { ok: true }; };
    expect((await recv(store, charge("REF-9"), true, idem)).kind).toBe("processed");
    expect(store.rows[0]?.status).toBe("processing");
    store.advance(200_000);
    expect(await drainInbox(store, { paystack: idem, zoom: idem, resend: idem })).toEqual({ ok: true, data: { processed: 1, failed: 0 } });
    expect(effects.size).toBe(1);
    expect(store.rows[0]?.status).toBe("processed");
  });

  it("handles events that arrive in the wrong order: each is stored and dispatched on its own, the handler's state machine decides", async () => {
    const store = createMemoryInbox();
    let state = "sent";
    const payout: Dispatch = async (e) => {
      if (e.eventType === "transfer.reversed" && ["sent", "succeeded"].includes(state)) state = "reversed";
      else if (e.eventType === "transfer.success" && ["sent"].includes(state)) state = "succeeded"; // a success after a reversal is ignored
      return { ok: true };
    };
    const body = (event: string) => JSON.stringify({ event, data: { reference: "tpo-ref" } });
    await recv(store, body("transfer.reversed"), true, payout);
    await recv(store, body("transfer.success"), true, payout);
    expect(store.rows.map((r) => r.key)).toEqual(["transfer.reversed:tpo-ref", "transfer.success:tpo-ref"]);
    expect(store.rows.every((r) => r.status === "processed")).toBe(true);
    expect(state).toBe("reversed");
  });

  it("a replay of a processed event runs the handler again, and an idempotent handler still has one effect", async () => {
    const store = createMemoryInbox();
    const effects = new Map<string, number>();
    const handler: Dispatch = async (e) => { effects.set(e.idempotencyKey, 1); return { ok: true }; }; // keyed write: replay overwrites, never adds
    await recv(store, charge("REF-10"), true, handler);
    expect(store.replay(store.rows[0]!.id)).toBe(true);
    expect(store.rows[0]).toMatchObject({ status: "received", replays: 1 });
    expect(await drainInbox(store, { paystack: handler, zoom: handler, resend: handler })).toEqual({ ok: true, data: { processed: 1, failed: 0 } });
    expect(effects.size).toBe(1);
    expect(store.replay("missing")).toBe(false);
    // an event being handled right now cannot be replayed
    const slow = createMemoryInbox();
    await slow.record({ provider: "paystack", eventType: "x", idempotencyKey: "k", rawBody: "{}", verified: true });
    await slow.claim(slow.rows[0]!.id);
    expect(slow.replay(slow.rows[0]!.id)).toBe(false);
  });

  it("stops after the attempt limit: the event goes dead instead of retrying forever", async () => {
    const store = createMemoryInbox({ maxAttempts: 2 });
    const bad: Dispatch = async () => ({ ok: false, error: "still down" });
    await recv(store, charge("REF-11"), true, bad);
    await recv(store, charge("REF-11"), true, bad);
    expect(store.rows[0]).toMatchObject({ status: "dead", attempts: 2 });
    const third = await recv(store, charge("REF-11"), true, bad);
    expect(third.kind).toBe("duplicate");
    // an event that reached the cap through crashed leases is marked dead on the next claim
    const crashed = createMemoryInbox({ maxAttempts: 1 });
    await recv(crashed, charge("REF-12"), true, bad);
    crashed.rows[0]!.status = "received";
    expect(await crashed.claim(crashed.rows[0]!.id)).toEqual({ ok: true, data: null });
    expect(crashed.rows[0]?.status).toBe("dead");
    crashed.rows.push({ ...crashed.rows[0]!, id: "evt-x", key: "k2", status: "received", attempts: 1 });
    expect(await crashed.claimDue(5)).toEqual({ ok: true, data: [] });
  });

  it("falls back on a body hash key when the key cannot be derived", async () => {
    const store = createMemoryInbox();
    const out = await receiveProviderEvent(store, { provider: "zoom", rawBody: "not json", verified: true, derive: async () => { throw new Error("bad"); } }, counting().dispatch);
    expect(out.kind).toBe("processed");
    expect(store.rows[0]?.key).toMatch(/^raw:[0-9a-f]{64}$/);
    expect(store.rows[0]?.eventType).toBe("unparseable");
  });
});

describe("drainInbox", () => {
  it("retries failed events once their backoff has passed, routes by provider and counts the result", async () => {
    const store = createMemoryInbox();
    const bad: Dispatch = async () => ({ ok: false, error: "down" });
    await recv(store, charge("D-1"), true, bad);
    await receiveProviderEvent(store, { provider: "resend", rawBody: JSON.stringify({ type: "email.delivered" }), verified: true, derive: () => resendEventKey("{\"type\":\"email.delivered\"}", "msg_1") }, bad);
    const seen: string[] = [];
    const d = (name: string): Dispatch => async () => { seen.push(name); return name === "resend" ? { ok: false, error: "still down" } : { ok: true }; };
    expect(await drainInbox(store, { paystack: d("paystack"), zoom: d("zoom"), resend: d("resend") })).toEqual({ ok: true, data: { processed: 0, failed: 0 } }); // not due yet
    store.advance(60_000);
    expect(await drainInbox(store, { paystack: d("paystack"), zoom: d("zoom"), resend: d("resend") })).toEqual({ ok: true, data: { processed: 1, failed: 1 } });
    expect(seen.sort()).toEqual(["paystack", "resend"]);
  });

  it("passes a store failure through", async () => {
    const store = createMemoryInbox();
    store.failNext("claimDue");
    const r = await drainInbox(store, { paystack: counting().dispatch, zoom: counting().dispatch, resend: counting().dispatch });
    expect(r.ok).toBe(false);
  });
});

describe("idempotency keys", () => {
  it("paystack: event + reference, so a transfer reversal is not a replay of its success", async () => {
    expect(await paystackEventKey(JSON.stringify({ event: "transfer.success", data: { reference: "r1" } }))).toEqual({ eventType: "transfer.success", idempotencyKey: "transfer.success:r1" });
    expect(await paystackEventKey(JSON.stringify({ event: "transfer.reversed", data: { reference: "r1" } }))).toEqual({ eventType: "transfer.reversed", idempotencyKey: "transfer.reversed:r1" });
  });
  it("paystack: a refund is keyed by the original charge and the amount, whichever field carries the charge", async () => {
    for (const data of [{ transaction_reference: "c1", amount: 100 }, { transaction: { reference: "c1" }, amount: 100 }, { reference: "c1", amount: 100 }]) {
      expect((await paystackEventKey(JSON.stringify({ event: "refund.processed", data }))).idempotencyKey).toBe("refund.processed:c1:100");
    }
    // no usable charge or amount: falls through to the generic key
    expect((await paystackEventKey(JSON.stringify({ event: "refund.failed", data: { id: 77 } }))).idempotencyKey).toBe("refund.failed:77");
  });
  it("paystack: id, subscription code, then a hash of the body; a non-JSON body still gets a stable key", async () => {
    expect((await paystackEventKey(JSON.stringify({ event: "subscription.create", data: { subscription_code: "SUB_1" } }))).idempotencyKey).toBe("subscription.create:SUB_1");
    const hashed = await paystackEventKey(JSON.stringify({ event: "weird.event", data: {} }));
    expect(hashed.idempotencyKey).toMatch(/^weird\.event:sha256:[0-9a-f]{64}$/);
    expect((await paystackEventKey("not json")).idempotencyKey).toMatch(/^unknown:sha256:/);
    expect((await paystackEventKey("not json")).idempotencyKey).toBe((await paystackEventKey("not json")).idempotencyKey);
  });
  it("zoom: event + meeting uuid + event_ts; id when there is no uuid; hash when there is neither", async () => {
    expect(await zoomEventKey(JSON.stringify({ event: "meeting.ended", event_ts: 1700, payload: { object: { uuid: "u1", id: 9 } } }))).toEqual({ eventType: "meeting.ended", idempotencyKey: "meeting.ended:u1:1700" });
    expect((await zoomEventKey(JSON.stringify({ event: "meeting.started", payload: { object: { id: 9 } } }))).idempotencyKey).toBe("meeting.started:9:0");
    expect((await zoomEventKey(JSON.stringify({ event: "x", payload: {} }))).idempotencyKey).toMatch(/^x:sha256:/);
  });
  it("resend: the svix id, else a hash", async () => {
    expect(await resendEventKey(JSON.stringify({ type: "email.bounced" }), "msg_abc")).toEqual({ eventType: "email.bounced", idempotencyKey: "svix:msg_abc" });
    expect((await resendEventKey("{}", null)).idempotencyKey).toMatch(/^unknown:sha256:/);
  });
});

describe("supabaseInboxStore", () => {
  const client = (reply: (fn: string, args?: Record<string, unknown>) => { data: unknown; error: { message: string } | null }) => ({
    calls: [] as { fn: string; args?: Record<string, unknown> }[],
    rpc(fn: string, args?: Record<string, unknown>) { this.calls.push({ fn, args }); return Promise.resolve(reply(fn, args)); },
  });
  const input = { provider: "paystack" as const, eventType: "charge.success", idempotencyKey: "k", rawBody: "{}", verified: true };

  it("maps record, claim, complete and fail onto the database functions", async () => {
    const c = client((fn) => ({
      data: fn === "record_provider_event" ? { id: "e1", status: "received", duplicate: false, verified: true, body_differs: false }
        : fn === "claim_provider_event" ? "lease-1" : fn === "complete_provider_event" ? true : "failed",
      error: null,
    }));
    const s = supabaseInboxStore(c);
    expect(await s.record(input)).toEqual({ ok: true, data: { id: "e1", status: "received", duplicate: false, verified: true, bodyDiffers: false } });
    expect(await s.claim("e1")).toEqual({ ok: true, data: "lease-1" });
    expect(await s.complete("e1", "lease-1", { type: "order", id: "o" })).toEqual({ ok: true, data: true });
    expect(await s.complete("e1", "lease-1")).toEqual({ ok: true, data: true });
    expect(await s.fail("e1", "lease-1", "x".repeat(900), false)).toEqual({ ok: true, data: "failed" });
    expect(c.calls.map((x) => x.fn)).toEqual(["record_provider_event", "claim_provider_event", "complete_provider_event", "complete_provider_event", "fail_provider_event"]);
    expect(c.calls[2]?.args).toMatchObject({ p_entity_type: "order", p_entity_id: "o" });
    expect(c.calls[3]?.args).toMatchObject({ p_entity_type: null, p_entity_id: null });
    expect(String(c.calls[4]?.args?.["p_error"]).length).toBe(500);
  });

  it("claims null when there is nothing to do and refuses a malformed reply", async () => {
    expect(await supabaseInboxStore(client(() => ({ data: null, error: null }))).claim("e")).toEqual({ ok: true, data: null });
    expect((await supabaseInboxStore(client(() => ({ data: 5, error: null }))).claim("e")).ok).toBe(false);
    expect((await supabaseInboxStore(client(() => ({ data: { nope: 1 }, error: null }))).record(input)).ok).toBe(false);
    expect(await supabaseInboxStore(client(() => ({ data: "weird", error: null }))).complete("e", "l")).toEqual({ ok: true, data: false });
    expect(await supabaseInboxStore(client(() => ({ data: 7, error: null }))).fail("e", "l", "x", true)).toEqual({ ok: true, data: "unknown" });
  });

  it("reads the sweeper rows and rejects a malformed one", async () => {
    const row = { id: "e1", lease_token: "l1", provider: "zoom", event_type: "meeting.ended", idempotency_key: "k", raw_body: "{}", attempt_count: 2 };
    expect(await supabaseInboxStore(client(() => ({ data: [row], error: null }))).claimDue(5)).toEqual({
      ok: true, data: [{ id: "e1", leaseToken: "l1", provider: "zoom", eventType: "meeting.ended", idempotencyKey: "k", rawBody: "{}", attemptCount: 2 }],
    });
    expect(await supabaseInboxStore(client(() => ({ data: [{ ...row, attempt_count: "x" }], error: null }))).claimDue(5)).toMatchObject({ ok: true, data: [{ attemptCount: 0 }] });
    expect((await supabaseInboxStore(client(() => ({ data: [{ ...row, provider: "stripe" }], error: null }))).claimDue(5)).ok).toBe(false);
    expect((await supabaseInboxStore(client(() => ({ data: [null], error: null }))).claimDue(5)).ok).toBe(false);
    expect((await supabaseInboxStore(client(() => ({ data: "no", error: null }))).claimDue(5)).ok).toBe(false);
  });

  it("turns an rpc error or a thrown error into a failure value, never a throw", async () => {
    const s = supabaseInboxStore(client(() => ({ data: null, error: { message: "relation provider_events does not exist" } })));
    const r = await s.record(input);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.message).not.toContain("provider_events does not exist");
    const thrower = supabaseInboxStore({ rpc: () => { throw new Error("socket"); } });
    const t = await thrower.claim("e");
    expect(t.ok).toBe(false);
    if (!t.ok) expect(t.error.code).toBe("network");
  });
});
