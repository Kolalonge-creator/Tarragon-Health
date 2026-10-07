import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@tarragon/shared";

/**
 * What became of a reading the database accepted without an error.
 *
 * With the plausibility hold or the de-duplication switch on, an insert can succeed and still store nothing in the record (the trigger
 * returns no row): an impossible value is held for the person to check, and a duplicate from a worse source is linked to the reading
 * already there. Neither is an error and neither may be reported as "saved", so the routes ask the database which one it was.
 */
export type ReadingOutcome =
  | { kind: "saved"; id: string }
  | { kind: "held"; heldId: string; reasons: string[] }
  | { kind: "merged" }
  | { kind: "unknown" };

export interface OutcomeProbe {
  patientId: string;
  /** The idempotency id of the insert: external_reading_id for a device, client_reading_id for a photo. */
  externalReadingId?: string;
  clientReadingId?: string;
  deviceId?: string;
}

export async function readOutcome(supabase: SupabaseClient<Database>, probe: OutcomeProbe): Promise<ReadingOutcome> {
  try {
    let saved = supabase.from("vitals_readings").select("id").eq("patient_id", probe.patientId);
    if (probe.deviceId && probe.externalReadingId) saved = saved.eq("device_id", probe.deviceId).eq("external_reading_id", probe.externalReadingId);
    else if (probe.clientReadingId) saved = saved.eq("client_reading_id", probe.clientReadingId);
    else return { kind: "unknown" };
    const { data: row } = await saved.limit(1).maybeSingle();
    if (row?.id) return { kind: "saved", id: row.id };

    // Not in the record: held, or merged into a better source's reading? A held row carries the same idempotency id in its payload.
    let held = supabase.from("vitals_readings_held").select("id, reasons").eq("patient_id", probe.patientId).eq("state", "pending");
    if (probe.externalReadingId) held = held.eq("payload->>external_reading_id", probe.externalReadingId);
    else if (probe.clientReadingId) held = held.eq("payload->>client_reading_id", probe.clientReadingId);
    const { data: heldRow } = await held.order("created_at", { ascending: false }).limit(1).maybeSingle();
    if (heldRow?.id) return { kind: "held", heldId: heldRow.id, reasons: heldRow.reasons };

    return { kind: "merged" };
  } catch {
    return { kind: "unknown" };
  }
}

export interface BatchOutcome {
  saved: number;
  held: number;
  /** In neither place: linked to a reading already there from a better source. */
  merged: number;
}

/** For a batch with one connection and many ids (a glucose sensor stream): how many landed in the record, how many were held, how many merged. */
export async function readBatchOutcome(
  supabase: SupabaseClient<Database>,
  probe: { patientId: string; connectionColumn: "cgm_connection_id" | "wearable_connection_id"; connectionId: string; externalIds: string[] },
): Promise<BatchOutcome> {
  const total = probe.externalIds.length;
  try {
    const { count: saved } = await supabase
      .from("vitals_readings")
      .select("id", { count: "exact", head: true })
      .eq("patient_id", probe.patientId)
      .eq(probe.connectionColumn, probe.connectionId)
      .in("external_reading_id", probe.externalIds);
    let held = 0;
    for (let i = 0; i < probe.externalIds.length; i += 100) {
      const chunk = probe.externalIds.slice(i, i + 100);
      const { count } = await supabase
        .from("vitals_readings_held")
        .select("id", { count: "exact", head: true })
        .eq("patient_id", probe.patientId)
        .eq("state", "pending")
        .in("payload->>external_reading_id", chunk);
      held += count ?? 0;
    }
    const s = saved ?? 0;
    return { saved: s, held, merged: Math.max(0, total - s - held) };
  } catch {
    return { saved: total, held: 0, merged: 0 };
  }
}
