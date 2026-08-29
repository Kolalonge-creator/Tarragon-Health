// Tarragon Health — Interoperability & API Platform (spec §33)
// Outbound partner webhook drainer.
//
// pg_cron + pg_net invoking a Supabase Edge Function is this codebase's own
// established pattern for a scheduled job (see send-pending-notifications
// and its schedule_notification_sender migration) — followed here rather
// than a Vercel Cron route because this project's Vercel team is on the
// Hobby plan, which caps Vercel Cron Jobs to once per day. A once-daily
// drain would defeat §33.10/§33.11's whole point (bounded-latency retry
// with exponential backoff, not "eventually, some day"), so this runs on
// pg_cron every minute instead — sidestepping the Vercel plan limit
// entirely, exactly like every other frequent scheduled job on this
// platform already does.
//
// One pass: claim a batch via public.claim_integration_outbound_batch
// (SECURITY DEFINER, FOR UPDATE SKIP LOCKED — safe against overlapping
// invocations), POST each claimed event to its subscriber's URL with an
// HMAC-SHA256 signature, then record the outcome via
// public.record_integration_delivery_result, which itself decides
// delivered / retry-with-backoff / dead-letter (see the migration for the
// full state machine). This function makes no retry/backoff decisions of
// its own — that logic lives in the database as data (attempt_count,
// next_attempt_at), not in this loop's control flow, so it stays correct
// regardless of which invocation of this function eventually processes a
// given retry.
//
// Never throws past its own boundary: a single delivery failing, or the
// whole partner being unreachable, must never crash the pass — the next
// row (and the next minute's invocation) still needs to run.

import { createClient } from "jsr:@supabase/supabase-js@2";

const BATCH_SIZE = 25;
const DELIVERY_TIMEOUT_MS = 10_000;
// An Edge Function has a bounded wall-clock budget; draining the whole
// queue in one pass is not the goal — making steady progress every minute
// is. Looping a few batches per invocation absorbs a burst without one
// slow partner starving every other org's deliveries for a full minute.
const MAX_BATCHES_PER_RUN = 4;

interface ClaimedEvent {
  id: string;
  event_id: string;
  event_type: string;
  payload: Record<string, unknown>;
  attempt_count: number;
  max_attempts: number;
  url: string;
  secret: string;
  endpoint_name: string;
}

async function signPayload(secret: string, rawBody: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(rawBody));
  const hex = [...new Uint8Array(signature)].map((b) => b.toString(16).padStart(2, "0")).join("");
  return `sha256=${hex}`;
}

async function deliverOne(
  supabase: ReturnType<typeof createClient>,
  event: ClaimedEvent,
): Promise<{ ok: boolean; deadLettered: boolean }> {
  const envelope = {
    event_id: event.event_id,
    event_type: event.event_type,
    data: event.payload,
  };
  const rawBody = JSON.stringify(envelope);
  const signature = await signPayload(event.secret, rawBody);

  const startedAt = Date.now();
  let ok = false;
  let statusCode: number | null = null;
  let error: string | null = null;

  try {
    const response = await fetch(event.url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Tarragon-Signature": signature,
        "X-Tarragon-Event-Id": event.event_id,
        "X-Tarragon-Event-Type": event.event_type,
      },
      body: rawBody,
      signal: AbortSignal.timeout(DELIVERY_TIMEOUT_MS),
    });
    statusCode = response.status;
    ok = response.status >= 200 && response.status < 300;
    if (!ok) error = `HTTP ${response.status}`;
  } catch (err) {
    error = err instanceof Error ? err.message : "delivery failed";
  }

  const durationMs = Date.now() - startedAt;

  const { data: status } = await supabase.rpc("record_integration_delivery_result", {
    p_outbound_event_id: event.id,
    p_ok: ok,
    p_status_code: statusCode,
    p_error: error,
    p_duration_ms: durationMs,
  });

  return { ok, deadLettered: status === "dead_letter" };
}

Deno.serve(async () => {
  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  let delivered = 0;
  let failed = 0;
  let deadLettered = 0;
  let batches = 0;

  for (; batches < MAX_BATCHES_PER_RUN; batches++) {
    const { data: claimed, error: claimError } = await supabase
      .rpc("claim_integration_outbound_batch", { p_limit: BATCH_SIZE })
      .returns<ClaimedEvent[]>();

    if (claimError) {
      return Response.json(
        { delivered, failed, deadLettered, batches, error: claimError.message },
        { status: 200 },
      );
    }

    const rows = claimed ?? [];
    if (rows.length === 0) break;

    const results = await Promise.allSettled(rows.map((event) => deliverOne(supabase, event)));
    for (const result of results) {
      if (result.status === "fulfilled") {
        if (result.value.ok) delivered++;
        else failed++;
        if (result.value.deadLettered) deadLettered++;
      } else {
        failed++;
      }
    }

    if (rows.length < BATCH_SIZE) break;
  }

  return Response.json({ delivered, failed, deadLettered, batches });
});
