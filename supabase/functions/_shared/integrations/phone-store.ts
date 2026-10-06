import type { PhoneBridgeState } from "./phone.ts";

/**
 * Where a live phone bridge is remembered between the two moments the vendor needs us: placing the first call, and answering
 * the vendor's callback when the patient picks up. The row holds the clinician's number only while the bridge is live and
 * forgets it when the bridge ends (the database does this in a trigger and a sweep; the memory store here does the same).
 * Nothing in a bridge record is ever returned to a caller of the adapter.
 */
export interface BridgeRecord {
  readonly bridgeId: string;
  readonly encounterRef: string;
  /** The clinician's number, held only while the bridge is live. */
  readonly clinicianPhone: string | null;
  readonly providerSessionId: string | null;
  readonly state: PhoneBridgeState;
  readonly patientAnswered: boolean;
  /** True once the second call has been dialled. The vendor does not report that call being answered separately. */
  readonly clinicianDialled: boolean;
  readonly startedAtMs: number;
  readonly expiresAtMs: number;
}

export type BridgePatch = Partial<Pick<BridgeRecord, "providerSessionId" | "state" | "patientAnswered" | "clinicianDialled">>;

/** A bridge that never got a vendor session within this long failed to start: it is closed so it cannot block a new one. */
export const STALE_UNSTARTED_MS = 30_000;

export interface BridgeStore {
  /** Saves a new bridge. Returns false, saving nothing, when this encounter already has a live one (two people tapping at once). */
  create(record: BridgeRecord): Promise<boolean>;
  /** Closes this encounter's live bridges that are past their limit or never reached the vendor, so they cannot block a new one. */
  expireStale(encounterRef: string, nowMs: number): Promise<void>;
  get(bridgeId: string): Promise<BridgeRecord | null>;
  findBySession(providerSessionId: string): Promise<BridgeRecord | null>;
  /** The bridge for this encounter that is still ringing or connected and not past its limit, if any. */
  findLiveByEncounter(encounterRef: string, nowMs: number): Promise<BridgeRecord | null>;
  update(bridgeId: string, patch: BridgePatch): Promise<void>;
  /**
   * Atomically claims the right to dial the second person: returns the clinician's number once, and only while the bridge is live
   * and not yet dialled. A repeated or concurrent callback gets null, so the clinician is never rung twice for one bridge.
   */
  claimDial(bridgeId: string, nowMs: number): Promise<string | null>;
}

const live = (r: BridgeRecord, nowMs: number): boolean => (r.state === "ringing" || r.state === "connected") && r.expiresAtMs > nowMs;

/** In-memory store, for tests and development. Behaves like the database table: a finished bridge forgets the number. */
export function createMemoryBridgeStore(): BridgeStore {
  const rows = new Map<string, BridgeRecord>();
  const forget = (r: BridgeRecord): BridgeRecord => (r.state === "ended" || r.state === "failed" ? { ...r, clinicianPhone: null } : r);
  return {
    async create(record) {
      // like the database's one-live-bridge-per-encounter rule: any ringing or connected row counts, expired or not, until closed
      for (const r of rows.values()) if (r.encounterRef === record.encounterRef && (r.state === "ringing" || r.state === "connected")) return false;
      rows.set(record.bridgeId, forget(record));
      return true;
    },
    async expireStale(encounterRef, nowMs) {
      for (const r of rows.values()) {
        const unstarted = r.providerSessionId === null && r.startedAtMs < nowMs - STALE_UNSTARTED_MS;
        if (r.encounterRef === encounterRef && (r.state === "ringing" || r.state === "connected") && (r.expiresAtMs <= nowMs || unstarted)) rows.set(r.bridgeId, forget({ ...r, state: "ended" }));
      }
    },
    async get(bridgeId) {
      return rows.get(bridgeId) ?? null;
    },
    async findBySession(sessionId) {
      for (const r of rows.values()) if (r.providerSessionId === sessionId) return r;
      return null;
    },
    async findLiveByEncounter(encounterRef, nowMs) {
      for (const r of rows.values()) if (r.encounterRef === encounterRef && live(r, nowMs)) return r;
      return null;
    },
    async update(bridgeId, patch) {
      const r = rows.get(bridgeId);
      if (r) rows.set(bridgeId, forget({ ...r, ...patch }));
    },
    async claimDial(bridgeId, nowMs) {
      const r = rows.get(bridgeId);
      if (!r || !live(r, nowMs) || r.clinicianDialled || !r.clinicianPhone) return null;
      rows.set(bridgeId, { ...r, clinicianDialled: true, patientAnswered: true, state: "connected" });
      return r.clinicianPhone;
    },
  };
}
