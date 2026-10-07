// S10 event bus processor (spec Section 5).
//
// pg_cron calls this every 15 seconds (with the shared secret header x-process-events-secret); a best-effort pg_net call from the urgent-event trigger
// calls it at once for an urgent event (body {"urgent_only": true}). One pass claims batches of
// deliveries with a lease, runs the registered handler for each, and completes or fails them.
// All retry, backoff and dead-letter decisions are made in the database (fail_event_delivery),
// not here, so they stay correct whichever invocation handles a retry.
//
// Handlers are registered by handler_key in handlers.ts. A delivery whose handler_key has no
// handler goes straight to the dead letter (it is visible in event_bus_health(), never dropped).
// Never throws past its own boundary.

import { createClient } from "jsr:@supabase/supabase-js@2";
import { runBatches, type BusEvent, type BusPorts } from "../_shared/event-bus/dispatch.ts";
import { buildHandlers } from "./handlers.ts";

// Small batches: a delivery's lease starts at claim time and the batch runs one after another, so a
// batch must finish well inside event_bus_config.lease_seconds (60).
const BATCH_SIZE = 10;
const MAX_BATCHES = 6;
const BUDGET_MS = 20_000;

interface ClaimRow {
  delivery_id: string;
  lease_token: string;
  attempt_count: number;
  event_id: string;
  event_type: string;
  event_version: number;
  organisation_id: string;
  patient_id: string | null;
  aggregate_type: string | null;
  aggregate_id: string | null;
  payload: Record<string, unknown>;
  priority: "normal" | "urgent";
  is_test: boolean;
  occurred_at: string;
  subscriber_key: string;
  handler_key: string;
}

// Constant-time comparison so the secret cannot be guessed by timing.
function sameSecret(a: string, b: string): boolean {
  const x = new TextEncoder().encode(a);
  const y = new TextEncoder().encode(b);
  let diff = x.length ^ y.length;
  for (let i = 0; i < Math.max(x.length, y.length); i++) diff |= (x[i] ?? 0) ^ (y[i] ?? 0);
  return diff === 0;
}

Deno.serve(async (req) => {
  // The publishable key is public, so on its own it must not be enough to start a pass (OQ-85).
  // Fails closed: no PROCESS_EVENTS_SECRET configured means nothing is processed.
  const expected = Deno.env.get("PROCESS_EVENTS_SECRET");
  if (!expected) return Response.json({ error: "not configured" }, { status: 503 });
  if (!sameSecret(req.headers.get("x-process-events-secret") ?? "", expected)) {
    return Response.json({ error: "unauthorised" }, { status: 401 });
  }

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    { auth: { persistSession: false } },
  );

  let urgentOnly = false;
  try {
    const body = await req.json();
    urgentOnly = body?.urgent_only === true;
  } catch {
    // cron sends no body
  }

  const ports: BusPorts = {
    async claim(limit, urgent) {
      const { data, error } = await supabase.rpc("claim_event_deliveries", { p_limit: limit, p_urgent_only: urgent });
      if (error) throw new Error(error.message);
      return (data as ClaimRow[]).map((r): BusEvent => ({
        deliveryId: r.delivery_id,
        leaseToken: r.lease_token,
        attempt: r.attempt_count,
        eventId: r.event_id,
        eventType: r.event_type,
        eventVersion: r.event_version,
        organisationId: r.organisation_id,
        patientId: r.patient_id,
        aggregateType: r.aggregate_type,
        aggregateId: r.aggregate_id,
        payload: r.payload,
        priority: r.priority,
        isTest: r.is_test,
        occurredAt: r.occurred_at,
        subscriberKey: r.subscriber_key,
        handlerKey: r.handler_key,
      }));
    },
    async complete(deliveryId, leaseToken) {
      const { data, error } = await supabase.rpc("complete_event_delivery", { p_delivery_id: deliveryId, p_lease_token: leaseToken });
      if (error) throw new Error(error.message);
      return data === true;
    },
    async fail(deliveryId, leaseToken, message, permanent) {
      const { data, error } = await supabase.rpc("fail_event_delivery", {
        p_delivery_id: deliveryId,
        p_lease_token: leaseToken,
        p_error: message,
        p_permanent: permanent,
      });
      if (error) throw new Error(error.message);
      return String(data);
    },
    async recordEffect(deliveryId, effectKey) {
      const { data, error } = await supabase.rpc("record_event_effect", { p_delivery_id: deliveryId, p_effect_key: effectKey });
      if (error) throw new Error(error.message);
      return data === true;
    },
    async releaseEffect(deliveryId, effectKey) {
      const { data, error } = await supabase.rpc("release_event_effect", { p_delivery_id: deliveryId, p_effect_key: effectKey });
      if (error) throw new Error(error.message);
      return data === true;
    },
    now: () => Date.now(),
    log(level, message, fields) {
      (level === "error" ? console.error : console.log)(JSON.stringify({ fn: "process-events", message, ...fields }));
    },
  };

  const summary = await runBatches(ports, buildHandlers(supabase), {
    urgentOnly,
    batchSize: BATCH_SIZE,
    maxBatches: MAX_BATCHES,
    budgetMs: BUDGET_MS,
  });
  return Response.json(summary, { status: summary.claimFailed ? 500 : 200 });
});
