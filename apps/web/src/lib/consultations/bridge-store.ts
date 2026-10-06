import "server-only";
import type { BridgePatch, BridgeRecord, BridgeStore } from "@tarragon/integrations";
import { createServiceRoleClient } from "@/lib/supabase/service-role";

/**
 * S21: the phone bridge store, on public.phone_bridges (service role only). The clinician's number is on a row only while the bridge
 * is live; the database forgets it the moment the bridge ends or fails, and a sweep closes any that were never closed. Nothing else
 * stores either number. The generated types do not carry the table yet, so the client is cast to the small shape this file uses.
 */
interface Row {
  bridge_id: string;
  encounter_id: string;
  clinician_phone: string | null;
  provider_session_id: string | null;
  state: BridgeRecord["state"];
  patient_answered: boolean;
  clinician_dialled: boolean;
  started_at: string;
  expires_at: string;
}
interface DbError {
  message: string;
  code?: string;
}
type Outcome<T> = PromiseLike<{ data: T | null; error: DbError | null }>;
interface Builder extends PromiseLike<{ data: Row[] | null; error: DbError | null }> {
  select(columns?: string): Builder;
  insert(values: Record<string, unknown>): Builder;
  update(values: Record<string, unknown>): Builder;
  eq(column: string, value: unknown): Builder;
  in(column: string, values: readonly unknown[]): Builder;
  gt(column: string, value: unknown): Builder;
  not(column: string, operator: string, value: unknown): Builder;
  or(filters: string): Builder;
  limit(count: number): Builder;
  maybeSingle(): Outcome<Row>;
}
export interface LooseClient {
  from(table: string): Builder;
}

const toRecord = (r: Row): BridgeRecord => ({
  bridgeId: r.bridge_id,
  encounterRef: r.encounter_id,
  clinicianPhone: r.clinician_phone,
  providerSessionId: r.provider_session_id,
  state: r.state,
  patientAnswered: r.patient_answered,
  clinicianDialled: r.clinician_dialled,
  startedAtMs: Date.parse(r.started_at),
  expiresAtMs: Date.parse(r.expires_at),
});

const must = <T>(res: { data: T | null; error: DbError | null }): T | null => {
  if (res.error) throw new Error("bridge store failed");
  return res.data;
};

const STALE_UNSTARTED_MS = 30_000;

/** The client is made on first use, so asking for a store (every consultation action does) costs nothing when no bridge is touched. */
export function createBridgeStore(supplied?: LooseClient): BridgeStore {
  let made: LooseClient | undefined = supplied;
  const db = (): LooseClient => (made ??= createServiceRoleClient() as unknown as LooseClient);
  const table = () => db().from("phone_bridges");
  return {
    async create(record) {
      const enc = must(await db().from("encounters").select("organisation_id, is_test").eq("id", record.encounterRef).maybeSingle()) as { organisation_id: string; is_test: boolean } | null;
      if (!enc) throw new Error("bridge store failed");
      const inserted = await table().insert({
          bridge_id: record.bridgeId,
          organisation_id: enc.organisation_id,
          encounter_id: record.encounterRef,
          provider: "africastalking",
          provider_session_id: record.providerSessionId,
          clinician_phone: record.clinicianPhone,
          state: record.state,
          patient_answered: record.patientAnswered,
          clinician_dialled: record.clinicianDialled,
          started_at: new Date(record.startedAtMs).toISOString(),
          expires_at: new Date(record.expiresAtMs).toISOString(),
          is_test: enc.is_test,
      });
      // the one-live-bridge-per-encounter index refused it: someone set up a bridge for this consultation in the same instant
      if (inserted.error?.code === "23505") return false;
      must(inserted);
      return true;
    },
    async expireStale(encounterRef, nowMs) {
      const now = new Date(nowMs).toISOString();
      const unstartedBefore = new Date(nowMs - STALE_UNSTARTED_MS).toISOString();
      must(
        await table()
          .update({ state: "ended" })
          .eq("encounter_id", encounterRef)
          .in("state", ["ringing", "connected"])
          .or(`expires_at.lte.${now},and(provider_session_id.is.null,started_at.lt.${unstartedBefore})`),
      );
    },
    async get(bridgeId) {
      const row = must(await table().select("*").eq("bridge_id", bridgeId).maybeSingle());
      return row ? toRecord(row) : null;
    },
    async findBySession(providerSessionId) {
      const row = must(await table().select("*").eq("provider_session_id", providerSessionId).maybeSingle());
      return row ? toRecord(row) : null;
    },
    async findLiveByEncounter(encounterRef, nowMs) {
      const rows = must(await table().select("*").eq("encounter_id", encounterRef).in("state", ["ringing", "connected"]).gt("expires_at", new Date(nowMs).toISOString()).limit(1));
      return rows && rows[0] ? toRecord(rows[0]) : null;
    },
    async update(bridgeId, patch: BridgePatch) {
      const values: Record<string, unknown> = {};
      if (patch.providerSessionId !== undefined) values.provider_session_id = patch.providerSessionId;
      if (patch.state !== undefined) values.state = patch.state;
      if (patch.patientAnswered !== undefined) values.patient_answered = patch.patientAnswered;
      if (patch.clinicianDialled !== undefined) values.clinician_dialled = patch.clinicianDialled;
      if (Object.keys(values).length === 0) return;
      must(await table().update(values).eq("bridge_id", bridgeId));
    },
    async claimDial(bridgeId, nowMs) {
      // One statement: only the first caller changes the row, so a repeated or concurrent callback never dials the clinician twice.
      const rows = must(
        await table()
          .update({ clinician_dialled: true, patient_answered: true, state: "connected" })
          .eq("bridge_id", bridgeId)
          .eq("clinician_dialled", false)
          .in("state", ["ringing", "connected"])
          .gt("expires_at", new Date(nowMs).toISOString())
          .not("clinician_phone", "is", null)
          .select("clinician_phone"),
      );
      return rows && rows[0] ? rows[0].clinician_phone : null;
    },
  };
}
