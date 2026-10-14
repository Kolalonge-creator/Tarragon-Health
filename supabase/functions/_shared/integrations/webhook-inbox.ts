import { sha256Hex } from "./crypto.ts";
import { asObject } from "./http.ts";
import { fail, ok, type ProviderResult } from "./result.ts";

/**
 * Provider event inbox (S14x, plan item R5). Every webhook from Paystack, Zoom or Resend is written down BEFORE anything acts on it:
 *
 *   1. The signature is checked by the vendor's own adapter (the caller passes the result in as `verified`).
 *   2. The raw body is stored exactly as received, with the signature result and an idempotency key. The row never changes.
 *   3. A bad signature is stored as 'rejected' (forensics) and is NEVER dispatched, replayed or retried.
 *   4. A verified event is claimed under a lease and handed to a handler. The same event delivered again finds the row: if it is
 *      processed or in flight nothing runs a second time; if it failed earlier, the redelivery is itself the retry.
 *   5. complete / fail record the result. A failed event backs off and is retried by `drainInbox`; an admin can replay one.
 *
 * Idempotency keys (the vendor sends no usable event id for Paystack):
 *   Paystack: event type + the reference it is about (refunds also add the amount; transfers share one reference across
 *             success and reversed, so the event type keeps the reversal from being dropped as a replay of the success).
 *   Zoom:     event type + the meeting uuid (or id) + event_ts. x-zm-request-id is not documented as stable [NV].
 *   Resend:   the Svix message id, which Svix keeps across its own retries.
 *
 * What this does NOT do: make a handler idempotent. A replay re-runs the handler, so every handler must be safe to run twice
 * (the payout, order and notification writers all are). Plain TypeScript with no Deno or Node globals, so Jest tests it.
 */
export type InboxProvider = "paystack" | "zoom" | "resend";

export interface InboxRecord {
  readonly id: string;
  readonly status: string;
  readonly duplicate: boolean;
  readonly verified: boolean;
  readonly bodyDiffers: boolean;
}
export interface ClaimedEvent {
  readonly id: string;
  readonly leaseToken: string;
  readonly provider: InboxProvider;
  readonly eventType: string;
  readonly idempotencyKey: string;
  readonly rawBody: string;
  readonly attemptCount: number;
}
export interface LinkedEntity {
  readonly type: string;
  readonly id: string;
}

/** The database half. `supabaseInboxStore` is the real one; tests use an in-memory copy of the same rules. */
export interface InboxStore {
  record(input: { provider: InboxProvider; eventType: string; idempotencyKey: string; rawBody: string; verified: boolean }): Promise<ProviderResult<InboxRecord>>;
  /** The lease token, or null when there is nothing to do (processed, in flight, rejected, dead). */
  claim(id: string): Promise<ProviderResult<string | null>>;
  claimDue(limit: number): Promise<ProviderResult<readonly ClaimedEvent[]>>;
  complete(id: string, leaseToken: string, entity?: LinkedEntity): Promise<ProviderResult<boolean>>;
  fail(id: string, leaseToken: string, error: string, permanent: boolean): Promise<ProviderResult<string>>;
}

export interface InboundEvent {
  readonly provider: InboxProvider;
  readonly eventType: string;
  readonly idempotencyKey: string;
  readonly rawBody: string;
}
export type DispatchOutcome =
  | { readonly ok: true; readonly entity?: LinkedEntity }
  | { readonly ok: false; readonly error: string; readonly permanent?: boolean };
export type Dispatch = (event: InboundEvent) => Promise<DispatchOutcome>;

export type ReceiveOutcome =
  | { readonly kind: "processed"; readonly id: string; readonly entity?: LinkedEntity }
  | { readonly kind: "duplicate"; readonly id: string; readonly status: string }
  | { readonly kind: "rejected"; readonly id: string | null }
  | { readonly kind: "failed"; readonly id: string; readonly error: string; readonly status: string }
  | { readonly kind: "store_unavailable"; readonly error: string };

export interface Derived {
  readonly eventType: string;
  readonly idempotencyKey: string;
}

/**
 * Receives one webhook. `derive` reads the (still untrusted for an unverified body) JSON for the event type and key; it must not
 * throw. For a verified body the dispatch result is recorded; for an unverified one nothing is dispatched, ever.
 */
export async function receiveProviderEvent(
  store: InboxStore,
  input: { readonly provider: InboxProvider; readonly rawBody: string; readonly verified: boolean; readonly derive: () => Promise<Derived> },
  dispatch: Dispatch,
): Promise<ReceiveOutcome> {
  let derived: Derived;
  try {
    derived = await input.derive();
  } catch {
    derived = { eventType: "unparseable", idempotencyKey: `raw:${await sha256Hex(input.rawBody)}` };
  }
  const recorded = await store.record({ provider: input.provider, eventType: derived.eventType, idempotencyKey: derived.idempotencyKey, rawBody: input.rawBody, verified: input.verified });
  if (!input.verified) return { kind: "rejected", id: recorded.ok ? recorded.data.id : null };
  if (!recorded.ok) return { kind: "store_unavailable", error: recorded.error.message };

  const lease = await store.claim(recorded.data.id);
  if (!lease.ok) return { kind: "store_unavailable", error: lease.error.message };
  if (lease.data === null) return { kind: "duplicate", id: recorded.data.id, status: recorded.data.status };

  return await runDispatch(store, { id: recorded.data.id, leaseToken: lease.data }, { provider: input.provider, eventType: derived.eventType, idempotencyKey: derived.idempotencyKey, rawBody: input.rawBody }, dispatch);
}

async function runDispatch(
  store: InboxStore,
  lease: { readonly id: string; readonly leaseToken: string },
  event: InboundEvent,
  dispatch: Dispatch,
): Promise<ReceiveOutcome> {
  let outcome: DispatchOutcome;
  try {
    outcome = await dispatch(event);
  } catch (e) {
    // A handler that throws is a retryable failure; its message is kept short and carries no body.
    outcome = { ok: false, error: e instanceof Error ? e.message.slice(0, 300) : "handler threw" };
  }
  if (outcome.ok) {
    // A lost completion is harmless: the event is still leased, expires, and is run again by a handler that is safe to run twice.
    await store.complete(lease.id, lease.leaseToken, outcome.entity);
    return outcome.entity ? { kind: "processed", id: lease.id, entity: outcome.entity } : { kind: "processed", id: lease.id };
  }
  const failed = await store.fail(lease.id, lease.leaseToken, outcome.error, outcome.permanent === true);
  return { kind: "failed", id: lease.id, error: outcome.error, status: failed.ok ? failed.data : "unknown" };
}

/** Retries what is due: failed events past their backoff and leases that expired. Run by the drain function and by an admin replay. */
export async function drainInbox(
  store: InboxStore,
  dispatchers: Readonly<Record<InboxProvider, Dispatch>>,
  limit = 20,
): Promise<ProviderResult<{ readonly processed: number; readonly failed: number }>> {
  const due = await store.claimDue(limit);
  if (!due.ok) return due;
  let processed = 0;
  let failed = 0;
  for (const e of due.data) {
    const out = await runDispatch(store, { id: e.id, leaseToken: e.leaseToken }, { provider: e.provider, eventType: e.eventType, idempotencyKey: e.idempotencyKey, rawBody: e.rawBody }, dispatchers[e.provider]);
    if (out.kind === "processed") processed += 1;
    else failed += 1;
  }
  return ok({ processed, failed });
}

// ---- idempotency keys (pure) ----

const str = (v: unknown): string | null => (typeof v === "string" && v.length > 0 ? v : typeof v === "number" && Number.isFinite(v) ? String(v) : null);

/** Paystack: `<event>:<reference>`; a refund adds the amount; an event with no identifier at all falls back on a hash of its body. */
export async function paystackEventKey(rawBody: string): Promise<Derived> {
  const root = parse(rawBody);
  const event = str(root?.["event"]) ?? "unknown";
  const data = asObject(root?.["data"]);
  if (event.startsWith("refund.")) {
    const charge = str(data?.["transaction_reference"]) ?? str(asObject(data?.["transaction"])?.["reference"]) ?? str(data?.["reference"]);
    const amount = str(data?.["amount"]);
    if (charge && amount) return { eventType: event, idempotencyKey: `${event}:${charge}:${amount}` };
  }
  const id = str(data?.["reference"]) ?? str(data?.["id"]) ?? str(data?.["subscription_code"]);
  return { eventType: event, idempotencyKey: id ? `${event}:${id}` : `${event}:sha256:${await sha256Hex(rawBody)}` };
}

/** Zoom: event + meeting uuid (or id) + event_ts. Never an empty key. */
export async function zoomEventKey(rawBody: string): Promise<Derived> {
  const root = parse(rawBody);
  const event = str(root?.["event"]) ?? "unknown";
  const obj = asObject(asObject(root?.["payload"])?.["object"]);
  const who = str(obj?.["uuid"]) ?? str(obj?.["id"]);
  const ts = str(root?.["event_ts"]);
  return { eventType: event, idempotencyKey: who ? `${event}:${who}:${ts ?? "0"}` : `${event}:sha256:${await sha256Hex(rawBody)}` };
}

/** Resend: the Svix message id. The event type comes from the body. */
export async function resendEventKey(rawBody: string, svixId: string | null): Promise<Derived> {
  const root = parse(rawBody);
  const type = str(root?.["type"]) ?? "unknown";
  return { eventType: type, idempotencyKey: svixId ? `svix:${svixId}` : `${type}:sha256:${await sha256Hex(rawBody)}` };
}

function parse(rawBody: string): Record<string, unknown> | null {
  try {
    return asObject(JSON.parse(rawBody));
  } catch {
    return null;
  }
}

// ---- the real store ----

/** The slice of a service-role Supabase client this store needs. Structural so tests need no vendor package. */
export interface InboxRpcClient {
  rpc(fn: string, args?: Record<string, unknown>): PromiseLike<{ data: unknown; error: { message: string } | null }>;
}

const PROVIDERS: ReadonlySet<string> = new Set(["paystack", "zoom", "resend"]);

export function supabaseInboxStore(client: InboxRpcClient): InboxStore {
  const call = async (fn: string, args: Record<string, unknown>): Promise<ProviderResult<unknown>> => {
    try {
      const { data, error } = await client.rpc(fn, args);
      if (error) return fail("vendor_error", `${fn} failed`, true);
      return ok(data);
    } catch {
      return fail("network", `${fn} could not be reached`);
    }
  };
  return {
    async record(i) {
      const r = await call("record_provider_event", { p_provider: i.provider, p_event_type: i.eventType, p_idempotency_key: i.idempotencyKey, p_raw_body: i.rawBody, p_verified: i.verified });
      if (!r.ok) return r;
      const d = asObject(r.data);
      if (!d || typeof d["id"] !== "string" || typeof d["status"] !== "string") return fail("bad_response", "Unexpected reply from record_provider_event");
      return ok({ id: d["id"], status: d["status"], duplicate: d["duplicate"] === true, verified: d["verified"] === true, bodyDiffers: d["body_differs"] === true });
    },
    async claim(id) {
      const r = await call("claim_provider_event", { p_id: id });
      if (!r.ok) return r;
      return r.data === null || typeof r.data === "string" ? ok(r.data) : fail("bad_response", "Unexpected reply from claim_provider_event");
    },
    async claimDue(limit) {
      const r = await call("claim_provider_events", { p_limit: limit });
      if (!r.ok) return r;
      if (!Array.isArray(r.data)) return fail("bad_response", "Unexpected reply from claim_provider_events");
      const out: ClaimedEvent[] = [];
      for (const row of r.data) {
        const d = asObject(row);
        if (!d || typeof d["id"] !== "string" || typeof d["lease_token"] !== "string" || typeof d["provider"] !== "string" || !PROVIDERS.has(d["provider"])
            || typeof d["event_type"] !== "string" || typeof d["idempotency_key"] !== "string" || typeof d["raw_body"] !== "string") {
          return fail("bad_response", "Unexpected row from claim_provider_events");
        }
        out.push({ id: d["id"], leaseToken: d["lease_token"], provider: d["provider"] as InboxProvider, eventType: d["event_type"], idempotencyKey: d["idempotency_key"], rawBody: d["raw_body"], attemptCount: typeof d["attempt_count"] === "number" ? d["attempt_count"] : 0 });
      }
      return ok(out);
    },
    async complete(id, leaseToken, entity) {
      const r = await call("complete_provider_event", { p_id: id, p_lease: leaseToken, p_entity_type: entity?.type ?? null, p_entity_id: entity?.id ?? null });
      return r.ok ? ok(r.data === true) : r;
    },
    async fail(id, leaseToken, error, permanent) {
      const r = await call("fail_provider_event", { p_id: id, p_lease: leaseToken, p_error: error.slice(0, 500), p_permanent: permanent });
      return r.ok ? ok(typeof r.data === "string" ? r.data : "unknown") : r;
    },
  };
}
