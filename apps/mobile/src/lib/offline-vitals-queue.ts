import type { VitalReadingPayload } from "./api";
import { flushOutbox, enqueue, getPendingCount as outboxPendingCount, listOutbox } from "./outbox";
import { supabase } from "./supabase";

/**
 * Vitals-facing view of the offline outbox (outbox.ts). Kept so the vitals
 * screen and lib/vitals.ts keep their API; the queue itself is now the one
 * outbox shared with symptoms and dose logs (S06).
 *
 * client_reading_id is the outbox row's client id, carried to
 * POST /api/mobile/vitals, which treats a replay as an idempotent no-op
 * (vitals_readings_client_dedupe_idx).
 */

export interface QueuedVital {
  clientReadingId: string;
  payload: VitalReadingPayload;
  beneficiaryProfileId?: string;
  createdAt: string;
}

/** Instant, zero-network write. Durable the moment this resolves. */
export async function enqueueVitalReading(
  payload: VitalReadingPayload,
  beneficiaryProfileId?: string,
  danger = false
): Promise<QueuedVital> {
  const {
    data: { session },
  } = await supabase.auth.getSession();
  const item = await enqueue({
    kind: "vital",
    subjectId: beneficiaryProfileId ?? session?.user?.id ?? "",
    beneficiaryProfileId,
    payload,
    danger,
  });
  return { clientReadingId: item.clientId, payload, beneficiaryProfileId, createdAt: item.createdAt };
}

/** Vitals not yet on the server (waiting or rejected). */
export async function getPendingVitals(): Promise<QueuedVital[]> {
  const items = await listOutbox("vital");
  return items.map((item) => ({
    clientReadingId: item.clientId,
    payload: item.payload as VitalReadingPayload,
    beneficiaryProfileId: item.beneficiaryProfileId,
    createdAt: item.createdAt,
  }));
}

/** Everything still on the phone, across vitals, symptoms and dose logs. */
export async function getPendingCount(): Promise<number> {
  return outboxPendingCount();
}

export interface FlushResult {
  synced: number;
  remaining: number;
  stoppedOffline: boolean;
}

/** Drains the whole outbox (every kind), see flushOutbox. */
export async function flushPendingVitals(): Promise<FlushResult> {
  const { synced, remaining, stoppedOffline } = await flushOutbox();
  return { synced, remaining, stoppedOffline };
}
