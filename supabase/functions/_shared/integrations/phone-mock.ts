import { isUuid } from "./ids.ts";
import { isE164, MAX_BRIDGE_MINUTES, type PhoneBridgeProvider, type PhoneParty } from "./phone.ts";
import { fail, ok } from "./result.ts";

export interface MockPhoneControl {
  /** One side picks up. The bridge is connected once both have. */
  answer(bridgeId: string, party: PhoneParty): void;
  /** A leg that could not be placed (busy, unreachable). */
  failLeg(bridgeId: string): void;
  failNextCall(): void;
}

export function createMockPhone(now: () => number = () => Date.now()): PhoneBridgeProvider & MockPhoneControl {
  type Row = { encounterRef: string; startedAtMs: number; expiresAtMs: number; patient: boolean; clinician: boolean; ended: boolean; failed: boolean };
  const bridges = new Map<string, Row>();
  const liveFor = new Map<string, string>();
  let failNext = false;
  let seq = 0;

  const dropped = () => {
    if (!failNext) return null;
    failNext = false;
    return fail("network", "Could not reach the vendor");
  };
  // A bridge that has outlived its limit is over, whether or not anyone hung up.
  const settle = (row: Row) => {
    if (!row.ended && row.expiresAtMs <= now()) row.ended = true;
    return row;
  };

  return {
    name: "mock",
    isMock: true,

    answer(bridgeId, party) {
      const row = bridges.get(bridgeId);
      if (row) row[party] = true;
    },
    failLeg(bridgeId) {
      const row = bridges.get(bridgeId);
      if (row) row.failed = true;
    },
    failNextCall() {
      failNext = true;
    },

    async connect(input) {
      const d = dropped();
      if (d) return d;
      if (!isUuid(input.encounterRef)) return fail("invalid_input", "Encounter reference must be an opaque uuid");
      if (!isE164(input.patientPhone) || !isE164(input.clinicianPhone)) return fail("invalid_input", "Phone numbers must be in international format");
      if (input.patientPhone === input.clinicianPhone) return fail("invalid_input", "The two phone numbers must differ");
      if (!Number.isInteger(input.maxMinutes) || input.maxMinutes <= 0 || input.maxMinutes > MAX_BRIDGE_MINUTES) return fail("invalid_input", "Call length is out of range");
      const existing = liveFor.get(input.encounterRef);
      const live = existing ? bridges.get(existing) : undefined;
      if (existing && live && !settle(live).ended) return ok({ bridgeId: existing, startedAtMs: live.startedAtMs, expiresAtMs: live.expiresAtMs });
      seq += 1;
      // Opaque on purpose: nothing derived from the encounter or either number.
      const bridgeId = `br_${seq.toString(36)}_${Math.floor(now() % 1_000_000).toString(36)}`;
      const startedAtMs = now();
      const expiresAtMs = startedAtMs + input.maxMinutes * 60_000;
      bridges.set(bridgeId, { encounterRef: input.encounterRef, startedAtMs, expiresAtMs, patient: false, clinician: false, ended: false, failed: false });
      liveFor.set(input.encounterRef, bridgeId);
      return ok({ bridgeId, startedAtMs, expiresAtMs });
    },

    async status(bridgeId) {
      const d = dropped();
      if (d) return d;
      const row = bridges.get(bridgeId);
      if (!row) return fail("not_found", "No such call", false);
      settle(row);
      const state = row.failed ? "failed" : row.ended ? "ended" : row.patient && row.clinician ? "connected" : "ringing";
      return ok({ state, patientAnswered: row.patient, clinicianAnswered: row.clinician });
    },

    async hangup(bridgeId) {
      const d = dropped();
      if (d) return d;
      const row = bridges.get(bridgeId);
      if (!row) return fail("not_found", "No such call", false);
      row.ended = true;
      return ok({ endedAtMs: now() });
    },
  };
}
