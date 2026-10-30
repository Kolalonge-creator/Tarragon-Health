import { loose } from "@/lib/clinician/loose-client";
import type { TimeEntryInput } from "@/lib/clinician/time-capture";

/** The one call both the server action and the unload route make, so they cannot drift. Input is already validated by the caller. */
export async function recordTimeEntry(client: unknown, entry: TimeEntryInput): Promise<{ ok: boolean }> {
  const { error } = await loose(client).rpc("record_clinician_time", {
    p_source: entry.source,
    p_source_ref: entry.sourceRef,
    p_patient: entry.patientId,
    p_seconds: entry.seconds,
    p_client_key: entry.clientKey,
  });
  return { ok: !error };
}
