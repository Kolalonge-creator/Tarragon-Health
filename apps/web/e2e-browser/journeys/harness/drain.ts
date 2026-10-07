// S85 journey harness: drain the event bus synchronously.
//
// In production pg_cron calls the `process-events` edge function every 15 seconds. A journey cannot wait for that, and the
// edge runtime is not part of the local stack the browser job starts. So the harness runs the SAME code the edge function
// runs: the dispatcher (runBatches) and the handler registry (buildHandlers) are imported from supabase/functions, and only the
// small port layer below is repeated here. packages/shared/src/journeys/drain-parity.test.ts compares this file's RPC names with
// process-events/index.ts so the two cannot drift apart.
//
// A fetch spy records every host contacted while handlers run. INV-01 says no language model is ever in the triage path; the
// journeys assert the only host a handler talked to is the local Supabase API.

import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { runBatches, type BusEvent, type BusPorts, type RunSummary } from "../../../../../supabase/functions/_shared/event-bus/dispatch";
import { buildHandlers } from "../../../../../supabase/functions/process-events/handlers";
import type { RpcClient } from "../../../../../supabase/functions/process-events/triage-ports";
import { realClock, type Clock } from "./clock";
import { journeyEnv } from "./env";

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

export interface DrainResult {
  readonly summary: RunSummary;
  readonly passes: number;
  /** Hostnames contacted through fetch while the handlers ran. */
  readonly hosts: readonly string[];
}

export function serviceClient(spy?: typeof fetch): SupabaseClient {
  const { apiUrl, serviceKey } = journeyEnv();
  return createClient(apiUrl, serviceKey, { auth: { persistSession: false }, ...(spy ? { global: { fetch: spy } } : {}) });
}

function portsFor(supabase: SupabaseClient, clock: Clock): BusPorts {
  return {
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
    now: () => clock.now(),
    log() {
      // quiet: a dead letter is asserted through the summary, not scraped from a log
    },
  };
}

/**
 * Run the bus until a pass claims nothing (handlers emit follow-on events, such as triage.graded after observation.recorded,
 * so one pass is rarely enough). Bounded by maxPasses so a loop cannot hang a test.
 */
export async function drainBus(opts: { clock?: Clock; maxPasses?: number } = {}): Promise<DrainResult> {
  const clock = opts.clock ?? realClock;
  const maxPasses = opts.maxPasses ?? 8;
  // supabase-js keeps the fetch it was created with, so the spy is handed to the client rather than patched onto globalThis.
  const hosts = new Set<string>();
  const spy = ((input: RequestInfo | URL, init?: RequestInit) => {
    try {
      const raw = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
      hosts.add(new URL(raw).hostname);
    } catch {
      hosts.add("unparseable");
    }
    return fetch(input, init);
  }) as typeof fetch;
  const supabase = serviceClient(spy);
  const handlers = buildHandlers({
    rpc: (name, args) => supabase.rpc(name, args),
  } satisfies RpcClient);

  const total: RunSummary = { batches: 0, claimed: 0, done: 0, retried: 0, dead: 0, lostLease: 0, errors: 0, claimFailed: false };
  let passes = 0;
  for (; passes < maxPasses; passes++) {
      const s = await runBatches(portsFor(supabase, clock), handlers, { urgentOnly: false, batchSize: 10, maxBatches: 6, budgetMs: 20_000 });
      total.batches += s.batches;
      total.claimed += s.claimed;
      total.done += s.done;
      total.retried += s.retried;
      total.dead += s.dead;
      total.lostLease += s.lostLease;
      total.errors += s.errors;
      total.claimFailed = total.claimFailed || s.claimFailed;
      if (s.claimed === 0) break;
  }
  return { summary: total, passes: passes + 1, hosts: [...hosts] };
}
