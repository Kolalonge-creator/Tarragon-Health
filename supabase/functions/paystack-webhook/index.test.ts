// Replay/idempotency and correctness coverage for the Paystack webhook —
// this project's authoritative source of truth for subscription/service
// activation (see handler.ts's own header). Until now this handler had zero
// direct tests: it's a Deno edge function, outside Jest's reach, and the
// only existing check was a byte-for-byte drift guard on the refund-key
// derivation block (apps/web/src/lib/billing/refund-idempotency.test.ts).
// Imports from handler.ts, not index.ts — index.ts is the real deployed
// entrypoint and does nothing but call Deno.serve; see its own header for
// why the logic was split out rather than tested via an import.meta.main
// guard in the same file.
//
// Runs against a FakeSupabaseClient (test-fake-supabase.ts), not a live
// Supabase project — deliberately, since this sandbox has neither Docker
// nor the Supabase CLI available, and the handler's logic (idempotency
// branching, event-kind routing, refund correlation) is what needs
// covering, not Postgres itself. The fake enforces the SAME
// unique(provider, provider_event_id) constraint the real schema does
// (supabase/migrations/20260712201507_payment_transactions.sql) so the
// replay tests exercise the real guarantee, not a looser one.
//
// Run: deno test --allow-env=PAYSTACK_WEBHOOK_SECRET --no-config
//        supabase/functions/paystack-webhook/index.test.ts

import { assert, assertEquals, assertExists } from "jsr:@std/assert@1";
import { handleWebhookRequest, verifySignature } from "./handler.ts";
import { FakeSupabaseClient } from "./test-fake-supabase.ts";

const SECRET = "test-webhook-secret-do-not-use-in-prod";

// Set once for the whole suite (module-level code runs under the full
// process permission set, not a per-Deno.test scope) — every test below
// that posts through handleWebhookRequest relies on this being the value
// Deno.env.get("PAYSTACK_WEBHOOK_SECRET") returns inside the handler. The
// one test that needs it actually unset temporarily deletes and restores it.
Deno.env.set("PAYSTACK_WEBHOOK_SECRET", SECRET);

function newClient(): FakeSupabaseClient {
  return new FakeSupabaseClient({
    payment_transactions: { uniqueOn: [["provider", "provider_event_id"]] },
  });
}

async function sign(secret: string, body: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-512" },
    false,
    ["sign"],
  );
  const mac = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(body));
  return Array.from(new Uint8Array(mac)).map((b) => b.toString(16).padStart(2, "0")).join("");
}

async function postWith(
  client: FakeSupabaseClient,
  body: unknown,
  opts: { signature?: string | null; method?: string; raw?: string } = {},
): Promise<{ response: Response; json: Record<string, unknown> }> {
  const raw = opts.raw ?? JSON.stringify(body);
  const signature = opts.signature === undefined ? await sign(SECRET, raw) : opts.signature;
  const headers = new Headers();
  if (signature !== null) headers.set("x-paystack-signature", signature);
  const method = opts.method ?? "POST";
  const request = new Request("https://example.com/functions/v1/paystack-webhook", {
    method,
    headers,
    // The Fetch API forbids a body on GET/HEAD — the 405 test needs a
    // request that never gets far enough to read one anyway.
    body: method === "GET" || method === "HEAD" ? undefined : raw,
  });
  // deno-lint-ignore no-explicit-any
  const res = await handleWebhookRequest(request, client as any);
  // The 405 path returns a plain-text body, not JSON — every other path
  // always returns JSON (see index.ts's own header: "always returns 200").
  let json: Record<string, unknown> = {};
  try {
    json = await res.clone().json();
  } catch {
    // non-JSON body (405 case) — callers checking `response.status` don't need `json`.
  }
  return { response: res, json };
}

function chargeSuccess(overrides: Record<string, unknown> = {}) {
  return {
    event: "charge.success",
    data: {
      reference: "TXN_REF_001",
      amount: 1500000,
      currency: "NGN",
      metadata: { kind: "subscription", profile_id: "profile-1", item_code: "essential" },
      ...overrides,
    },
  };
}

function refundEvent(event: string, overrides: Record<string, unknown> = {}) {
  return {
    event,
    data: {
      transaction_reference: "TXN_REF_001",
      amount: 500000,
      currency: "NGN",
      ...overrides,
    },
  };
}

// ---------------------------------------------------------------------------
// Signature verification — fail-closed behaviour
// ---------------------------------------------------------------------------

Deno.test({
  name: "verifySignature: rejects when the secret is unset (fail closed, not degrade open)",
  permissions: "none",
  async fn() {
    const ok = await verifySignature("body", "anything", undefined);
    assertEquals(ok, false);
  },
});

Deno.test({
  name: "verifySignature: rejects a missing signature header",
  permissions: "none",
  async fn() {
    const ok = await verifySignature("body", null, SECRET);
    assertEquals(ok, false);
  },
});

Deno.test({
  name: "verifySignature: rejects a tampered body against a signature computed for the original",
  permissions: "none",
  async fn() {
    const original = JSON.stringify({ event: "charge.success", data: { reference: "A" } });
    const tampered = JSON.stringify({ event: "charge.success", data: { reference: "B" } });
    const sig = await sign(SECRET, original);
    const ok = await verifySignature(tampered, sig, SECRET);
    assertEquals(ok, false);
  },
});

Deno.test({
  name: "verifySignature: accepts a correctly-signed body",
  permissions: "none",
  async fn() {
    const body = JSON.stringify({ event: "charge.success", data: { reference: "A" } });
    const sig = await sign(SECRET, body);
    const ok = await verifySignature(body, sig, SECRET);
    assertEquals(ok, true);
  },
});

Deno.test({
  name: "handleWebhookRequest: 405s anything that isn't POST",
  permissions: { env: ["PAYSTACK_WEBHOOK_SECRET"] },
  async fn() {
    const client = newClient();
    const { response } = await postWith(client, chargeSuccess(), { method: "GET" });
    assertEquals(response.status, 405);
  },
});

Deno.test({
  name: "handleWebhookRequest: rejects a POST with no signature header at all",
  permissions: { env: ["PAYSTACK_WEBHOOK_SECRET"] },
  async fn() {
    const client = newClient();
    const { json } = await postWith(client, chargeSuccess(), { signature: null });
    assertEquals(json.ok, false);
    assertEquals(json.error, "invalid_signature");
    assertEquals(client.rows("payment_transactions").length, 0);
  },
});

Deno.test({
  name: "handleWebhookRequest: rejects a well-formed, correctly-signed event once PAYSTACK_WEBHOOK_SECRET is unset in the environment (fail closed, matching prod if the secret is ever missing)",
  permissions: { env: ["PAYSTACK_WEBHOOK_SECRET"] },
  async fn() {
    Deno.env.delete("PAYSTACK_WEBHOOK_SECRET");
    try {
      const client = newClient();
      const { json } = await postWith(client, chargeSuccess());
      assertEquals(json.ok, false);
      assertEquals(json.error, "invalid_signature");
      assertEquals(client.rows("payment_transactions").length, 0);
    } finally {
      Deno.env.set("PAYSTACK_WEBHOOK_SECRET", SECRET);
    }
  },
});

Deno.test({
  name: "handleWebhookRequest: rejects an invalid signature and records nothing",
  permissions: { env: ["PAYSTACK_WEBHOOK_SECRET"] },
  async fn() {
    const client = newClient();
    const { json } = await postWith(client, chargeSuccess(), { signature: "0".repeat(128) });
    assertEquals(json.ok, false);
    assertEquals(json.error, "invalid_signature");
    assertEquals(client.rows("payment_transactions").length, 0);
  },
});

Deno.test({
  name: "handleWebhookRequest: a validly-signed but malformed-JSON body is rejected without throwing",
  permissions: { env: ["PAYSTACK_WEBHOOK_SECRET"] },
  async fn() {
    const client = newClient();
    const { json } = await postWith(client, null, { raw: "{not valid json" });
    assertEquals(json.ok, false);
    assertEquals(json.error, "invalid_json");
    assertEquals(client.rows("payment_transactions").length, 0);
  },
});

// ---------------------------------------------------------------------------
// charge.success — activation + replay/idempotency
// ---------------------------------------------------------------------------

Deno.test({
  name: "charge.success (subscription): activates the row and records one processed payment_transactions row",
  permissions: { env: ["PAYSTACK_WEBHOOK_SECRET"] },
  async fn() {
    const client = newClient();
    client.seed("subscriptions", [
      { id: "sub-1", organisation_id: "org-1", interval: "monthly", pending_provider_ref: "TXN_REF_001", status: "trialing" },
    ]);

    const { json } = await postWith(client, chargeSuccess());
    assertEquals(json.ok, true);

    const sub = client.rows("subscriptions")[0];
    assertEquals(sub.status, "active");
    assertEquals(sub.provider_ref, "TXN_REF_001");
    assertEquals(sub.pending_provider_ref, null);

    const txns = client.rows("payment_transactions");
    assertEquals(txns.length, 1);
    assertEquals(txns[0].provider_event_id, "TXN_REF_001");
    assertExists(txns[0].processed_at);
  },
});

Deno.test({
  name: "charge.success: replaying the identical event is a no-op — one payment_transactions row, no double side effect",
  permissions: { env: ["PAYSTACK_WEBHOOK_SECRET"] },
  async fn() {
    const client = newClient();
    client.seed("subscriptions", [
      { id: "sub-1", organisation_id: "org-1", interval: "monthly", pending_provider_ref: "TXN_REF_001", status: "trialing" },
    ]);
    const event = chargeSuccess();

    const first = await postWith(client, event);
    assertEquals(first.json.ok, true);
    assertEquals(first.json.replay, undefined);

    const second = await postWith(client, event);
    assertEquals(second.json.ok, true);
    assertEquals(second.json.replay, true);

    assertEquals(client.rows("payment_transactions").length, 1);
    // Still exactly one active row, not re-activated/mutated a second time.
    assertEquals(client.rows("subscriptions").length, 1);
  },
});

Deno.test({
  name: "charge.success: two DIFFERENT references never collide — each gets its own payment_transactions row",
  permissions: { env: ["PAYSTACK_WEBHOOK_SECRET"] },
  async fn() {
    const client = newClient();
    client.seed("subscriptions", [
      { id: "sub-1", organisation_id: "org-1", interval: "monthly", pending_provider_ref: "TXN_REF_001", status: "trialing" },
      { id: "sub-2", organisation_id: "org-1", interval: "monthly", pending_provider_ref: "TXN_REF_002", status: "trialing" },
    ]);

    await postWith(client, chargeSuccess({ reference: "TXN_REF_001" }));
    await postWith(client, chargeSuccess({ reference: "TXN_REF_002" }));

    assertEquals(client.rows("payment_transactions").length, 2);
    assert(client.rows("subscriptions").every((r) => r.status === "active"));
  },
});

Deno.test({
  name: "charge.success (service_purchase): re-verifies the trigger's own activation rather than trusting it blindly",
  permissions: { env: ["PAYSTACK_WEBHOOK_SECRET"] },
  async fn() {
    const client = newClient();
    // Simulates the AFTER INSERT trigger (private.apply_service_purchase_payment)
    // having already activated the row by the time this switch runs.
    client.seed("service_purchases", [
      { id: "sp-1", organisation_id: "org-1", status: "active", payment_provider_ref: "TXN_REF_001" },
    ]);

    const { json } = await postWith(
      client,
      chargeSuccess({ metadata: { kind: "service_purchase", profile_id: "profile-1" } }),
    );
    assertEquals(json.ok, true);
    const txn = client.rows("payment_transactions")[0];
    assertExists(txn.processed_at);
    assertEquals(txn.organisation_id, "org-1");
  },
});

Deno.test({
  name: "charge.success (service_purchase): a trigger that DIDN'T activate the row surfaces as failed, not a silent false success",
  permissions: { env: ["PAYSTACK_WEBHOOK_SECRET"] },
  async fn() {
    const client = newClient();
    client.seed("service_purchases", [
      { id: "sp-1", organisation_id: "org-1", status: "pending_payment", payment_provider_ref: "TXN_REF_001" },
    ]);

    await postWith(client, chargeSuccess({ metadata: { kind: "service_purchase", profile_id: "profile-1" } }));

    const txn = client.rows("payment_transactions")[0];
    assertEquals(txn.processed_at, undefined);
    assert(typeof txn.error === "string" && txn.error.includes("still pending_payment"));
  },
});

// Regression coverage for the 5 CheckoutKind values that had NO branch at
// all until this change (voucher_payment, sponsored_subscription,
// screening_day_payment, subsidy_contribution, platform_credit_topup) —
// see handler.ts's charge.success handler for the full incident writeup,
// including the CORRECTED 2026-09-23 note: the first version of this branch
// trusted the trigger blindly (bare markProcessed(), no re-check), which a
// code review caught as a SILENT FALSE SUCCESS risk — subsidy_contribution's
// and platform_credit_topup's own triggers have documented silent no-op
// paths. These fixtures mirror exactly what each trigger's OWN migration
// leaves behind in its target table, both when it activated the row and
// when it didn't (stale/mismatched reference, or the trigger's silent
// no-op), so both directions are proven, not just the happy path.
const TRIGGER_ACTIVATED_KIND_FIXTURES: Record<
  "voucher_payment" | "sponsored_subscription" | "screening_day_payment" | "subsidy_contribution" | "platform_credit_topup",
  { table: string; activatedRow: Record<string, unknown>; notYetActivatedRow: Record<string, unknown> | null }
> = {
  voucher_payment: {
    table: "care_voucher_payments",
    activatedRow: { id: "vp-1", organisation_id: "org-1", status: "applied", pending_provider_ref: "TXN_REF_001" },
    notYetActivatedRow: { id: "vp-1", organisation_id: "org-1", status: "pending", pending_provider_ref: "TXN_REF_001" },
  },
  sponsored_subscription: {
    table: "service_purchases",
    activatedRow: { id: "sps-1", organisation_id: "org-1", status: "active", payment_provider_ref: "TXN_REF_001" },
    // This trigger only ever creates the row on success (it has no
    // pre-existing pending row to update) — "not yet activated" here means
    // no row exists at all, not a row stuck in some other status.
    notYetActivatedRow: null,
  },
  screening_day_payment: {
    table: "screening_day_payments",
    activatedRow: { id: "sdp-1", organisation_id: "org-1", status: "applied", pending_provider_ref: "TXN_REF_001" },
    notYetActivatedRow: { id: "sdp-1", organisation_id: "org-1", status: "pending", pending_provider_ref: "TXN_REF_001" },
  },
  subsidy_contribution: {
    table: "subsidy_contributions",
    activatedRow: { id: "sc-1", organisation_id: "org-1", status: "payment_confirmed", payment_provider_ref: "TXN_REF_001" },
    notYetActivatedRow: { id: "sc-1", organisation_id: "org-1", status: "pending_payment", pending_payment_provider_ref: "TXN_REF_001" },
  },
  platform_credit_topup: {
    table: "platform_credit_topup_intents",
    activatedRow: { id: "pct-1", organisation_id: "org-1", status: "completed", payment_provider_ref: "TXN_REF_001" },
    notYetActivatedRow: { id: "pct-1", organisation_id: "org-1", status: "pending_payment", pending_payment_provider_ref: "TXN_REF_001" },
  },
};

for (
  const kind of [
    "voucher_payment",
    "sponsored_subscription",
    "screening_day_payment",
    "subsidy_contribution",
    "platform_credit_topup",
  ] as const
) {
  const fixture = TRIGGER_ACTIVATED_KIND_FIXTURES[kind];

  Deno.test({
    name: `charge.success (${kind}): a genuinely trigger-activated row is marked processed, not misreported as a failed add-on lookup`,
    permissions: { env: ["PAYSTACK_WEBHOOK_SECRET"] },
    async fn() {
      const client = newClient();
      client.seed(fixture.table, [fixture.activatedRow]);
      await postWith(client, chargeSuccess({ metadata: { kind, profile_id: "profile-1" } }));

      const txn = client.rows("payment_transactions")[0];
      assertExists(txn.processed_at);
      assertEquals(txn.error, undefined);
      assertEquals(txn.organisation_id, "org-1");
      // The bug this regresses: subscription_add_ons must never even be
      // queried for these kinds, let alone left as the reason for a false
      // failure.
      assertEquals(client.rows("subscription_add_ons").length, 0);
    },
  });

  Deno.test({
    name: `charge.success (${kind}): a trigger that did NOT activate the row surfaces as failed, never a silent false success`,
    permissions: { env: ["PAYSTACK_WEBHOOK_SECRET"] },
    async fn() {
      const client = newClient();
      if (fixture.notYetActivatedRow) client.seed(fixture.table, [fixture.notYetActivatedRow]);
      await postWith(client, chargeSuccess({ metadata: { kind, profile_id: "profile-1" } }));

      const txn = client.rows("payment_transactions")[0];
      assertEquals(txn.processed_at, undefined);
      assert(typeof txn.error === "string" && txn.error.length > 0);
    },
  });
}

Deno.test({
  name: "charge.success (add_on): still routes to and activates subscription_add_ons — the one case the exhaustiveness rewrite must not have broken",
  permissions: { env: ["PAYSTACK_WEBHOOK_SECRET"] },
  async fn() {
    const client = newClient();
    client.seed("subscription_add_ons", [
      { id: "addon-1", organisation_id: "org-1", interval: "monthly", pending_provider_ref: "TXN_REF_001", status: "trialing" },
    ]);

    await postWith(client, chargeSuccess({ metadata: { kind: "add_on", profile_id: "profile-1" } }));

    const addOn = client.rows("subscription_add_ons")[0];
    assertEquals(addOn.status, "active");
    assertEquals(addOn.provider_ref, "TXN_REF_001");
    const txn = client.rows("payment_transactions")[0];
    assertExists(txn.processed_at);
    assertEquals(txn.subscription_add_on_id, "addon-1");
  },
});

Deno.test({
  name: "charge.success: a metadata.kind value outside the known 9 (a payload bug, not a real CheckoutKind) is recorded as an explicit unrecognised-kind failure, never silently treated as add_on",
  permissions: { env: ["PAYSTACK_WEBHOOK_SECRET"] },
  async fn() {
    const client = newClient();
    client.seed("subscription_add_ons", [
      { id: "addon-1", organisation_id: "org-1", interval: "monthly", pending_provider_ref: "TXN_REF_001", status: "trialing" },
    ]);

    await postWith(
      client,
      chargeSuccess({ metadata: { kind: "not_a_real_checkout_kind", profile_id: "profile-1" } }),
    );

    // The regression this proves: before the exhaustiveness rewrite, an
    // unrecognised kind fell into the add_on else-branch and WOULD have
    // activated this seeded row. It must not.
    assertEquals(client.rows("subscription_add_ons")[0].status, "trialing");
    const txn = client.rows("payment_transactions")[0];
    assertEquals(txn.processed_at, undefined);
    assert(typeof txn.error === "string" && txn.error.includes("unrecognised metadata.kind=not_a_real_checkout_kind"));
  },
});

// ---------------------------------------------------------------------------
// subscription.create — best-effort enrichment, exercises the fake client's
// .in()/.is()/.order()/.limit() chain (the only production code path that
// uses them)
// ---------------------------------------------------------------------------

Deno.test({
  name: "subscription.create: correlates to the most recent not-yet-enriched subscription for the matching plan and enriches provider_ref/provider_email_token",
  permissions: { env: ["PAYSTACK_WEBHOOK_SECRET"] },
  async fn() {
    const client = newClient();
    client.seed("subscription_plans", [{ id: "plan-1", paystack_plan_code: "PLN_essential" }]);
    client.seed("subscriptions", [
      {
        id: "sub-old",
        plan_id: "plan-1",
        provider: "paystack",
        status: "active",
        provider_email_token: null,
        started_at: "2026-09-01T00:00:00.000Z",
      },
      {
        id: "sub-new",
        plan_id: "plan-1",
        provider: "paystack",
        status: "trialing",
        provider_email_token: null,
        started_at: "2026-09-20T00:00:00.000Z",
      },
    ]);

    await postWith(client, {
      event: "subscription.create",
      data: {
        plan: { plan_code: "PLN_essential" },
        subscription_code: "SUB_code_001",
        email_token: "email_tok_001",
      },
    });

    // Picks the most recently started candidate, not just any match.
    const enriched = client.rows("subscriptions").find((r) => r.id === "sub-new")!;
    assertEquals(enriched.provider_ref, "SUB_code_001");
    assertEquals(enriched.provider_email_token, "email_tok_001");
    const untouched = client.rows("subscriptions").find((r) => r.id === "sub-old")!;
    assertEquals(untouched.provider_ref, undefined);
  },
});

Deno.test({
  name: "subscription.create: a plan code matching no subscription or add-on is recorded as failed, not silently dropped",
  permissions: { env: ["PAYSTACK_WEBHOOK_SECRET"] },
  async fn() {
    const client = newClient();
    await postWith(client, {
      event: "subscription.create",
      data: { plan: { plan_code: "PLN_unknown" }, subscription_code: "SUB_x", email_token: "tok_x" },
    });

    const txn = client.rows("payment_transactions")[0];
    assertEquals(txn.processed_at, undefined);
    assert(typeof txn.error === "string" && txn.error.includes("could not correlate"));
  },
});

// ---------------------------------------------------------------------------
// Refunds — pending/failed never post, only processed does; correlation;
// unidentifiable refunds are recorded for audit but never posted
// ---------------------------------------------------------------------------

Deno.test({
  name: "refund.pending: recorded for audit but never marked processed (no premature ledger reversal)",
  permissions: { env: ["PAYSTACK_WEBHOOK_SECRET"] },
  async fn() {
    const client = newClient();
    await postWith(client, refundEvent("refund.pending"));

    const txn = client.rows("payment_transactions")[0];
    assertExists(txn);
    assertEquals(txn.processed_at, undefined);
    assertEquals(txn.provider_event_id, "refund.pending:refund:TXN_REF_001:500000");
  },
});

Deno.test({
  name: "refund.processed: correlates to the original charge for organisation_id and marks processed",
  permissions: { env: ["PAYSTACK_WEBHOOK_SECRET"] },
  async fn() {
    const client = newClient();
    client.seed("payment_transactions", [
      { id: "orig-1", provider: "paystack", provider_event_id: "TXN_REF_001", organisation_id: "org-1" },
    ]);

    await postWith(client, refundEvent("refund.processed"));

    const refundTxn = client.rows("payment_transactions").find((r) => r.id !== "orig-1")!;
    assertExists(refundTxn);
    assertEquals(refundTxn.provider_event_id, "refund:TXN_REF_001:500000");
    assertExists(refundTxn.processed_at);
    assertEquals(refundTxn.organisation_id, "org-1");
  },
});

Deno.test({
  name: "refund.pending then refund.processed for the same charge: both recorded, only the second posts — namespacing prevents them colliding",
  permissions: { env: ["PAYSTACK_WEBHOOK_SECRET"] },
  async fn() {
    const client = newClient();
    await postWith(client, refundEvent("refund.pending"));
    await postWith(client, refundEvent("refund.processed"));

    assertEquals(client.rows("payment_transactions").length, 2);
    const pending = client.rows("payment_transactions").find((r) => r.provider_event_id?.toString().startsWith("refund.pending"))!;
    const processed = client.rows("payment_transactions").find((r) => r.provider_event_id === "refund:TXN_REF_001:500000")!;
    assertEquals(pending.processed_at, undefined);
    assertExists(processed.processed_at);
  },
});

Deno.test({
  name: "refund.processed: a genuine Paystack retry (identical body) is idempotent — never a second reversal",
  permissions: { env: ["PAYSTACK_WEBHOOK_SECRET"] },
  async fn() {
    const client = newClient();
    const event = refundEvent("refund.processed");

    const first = await postWith(client, event);
    assertEquals(first.json.replay, undefined);
    const second = await postWith(client, event);
    assertEquals(second.json.replay, true);

    assertEquals(client.rows("payment_transactions").length, 1);
  },
});

for (
  const { label, overrides } of [
    {
      label: "no identifiable charge reference and no amount",
      overrides: { transaction_reference: undefined, reference: undefined, amount: undefined },
    },
    {
      label: "a non-integer amount (a decimal string that isn't whole kobo)",
      overrides: { amount: "500.5" },
    },
  ] as const
) {
  Deno.test({
    name: `refund.processed with ${label}: recorded under a content hash, never posted`,
    permissions: { env: ["PAYSTACK_WEBHOOK_SECRET"] },
    async fn() {
      const client = newClient();
      const { json } = await postWith(client, refundEvent("refund.processed", overrides));

      assertEquals(json.ok, false);
      assertEquals(json.error, "refund_unidentifiable");
      const txn = client.rows("payment_transactions")[0];
      assertExists(txn);
      assert(String(txn.provider_event_id).startsWith("refund:unidentifiable:sha256:"));
      assertEquals(txn.processed_at, undefined);
    },
  });
}

// ---------------------------------------------------------------------------
// Unknown / forward-compatible event types — never silently dropped
// ---------------------------------------------------------------------------

Deno.test({
  name: "an event type Postgres doesn't recognise is coerced to 'other' and still recorded (never dropped on the floor)",
  permissions: { env: ["PAYSTACK_WEBHOOK_SECRET"] },
  async fn() {
    const client = newClient();
    const { json } = await postWith(client, { event: "some.future.event", data: {} });

    assertEquals(json.ok, true);
    const txn = client.rows("payment_transactions")[0];
    assertEquals(txn.event_type, "other");
    assertExists(txn.processed_at);
  },
});

Deno.test({
  name: "an identifier-less event is content-hash-keyed, not body-length-keyed — two different bodies of equal length never collide",
  permissions: { env: ["PAYSTACK_WEBHOOK_SECRET"] },
  async fn() {
    const client = newClient();
    await postWith(client, { event: "invoice.create", data: { note: "aaaa" } });
    await postWith(client, { event: "invoice.create", data: { note: "bbbb" } });

    assertEquals(client.rows("payment_transactions").length, 2);
    const [first, second] = client.rows("payment_transactions");
    assert(first.provider_event_id !== second.provider_event_id);
  },
});
