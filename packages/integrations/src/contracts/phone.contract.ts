import { describe, expect, it } from "@jest/globals";
import type { PhoneBridgeProvider, PhoneParty } from "../../../../supabase/functions/_shared/integrations/index.ts";

export interface PhoneFixture {
  readonly provider: PhoneBridgeProvider;
  advanceMs?(ms: number): void;
  answer?(bridgeId: string, party: PhoneParty): void;
  failLeg?(bridgeId: string): void;
  failNextCall?(): void;
}

const ENC = "7b9c2f0e-5d3a-4c11-9a52-0f6d1e8b7a44";
const ENC2 = "2f4b8c1d-9e07-4a63-b5d2-6c8e0a1f3d97";
const PATIENT = "+2348031234567";
const DOCTOR = "+2348097654321";

/** Runs against every implementation of PhoneBridgeProvider: the mock now, the chosen vendor when OQ-131 is decided. */
export function runPhoneContract(name: string, make: () => PhoneFixture, nowMs: () => number = () => Date.now()): void {
  const probe = make();
  const timed = probe.advanceMs ? it : it.skip;
  const driven = probe.answer && probe.failLeg ? it : it.skip;
  const dropped = probe.failNextCall ? it : it.skip;
  const input = { encounterRef: ENC, patientPhone: PATIENT, clinicianPhone: DOCTOR, maxMinutes: 30 };

  describe(`PhoneBridgeProvider contract: ${name}`, () => {
    it("connects two people and never hands either number back, in a result or an error", async () => {
      const f = make();
      const r = await f.provider.connect(input);
      expect(r.ok).toBe(true);
      if (!r.ok) return;
      expect(r.data.bridgeId).not.toContain(ENC);
      expect(JSON.stringify(r)).not.toContain(PATIENT.slice(4));
      expect(JSON.stringify(r)).not.toContain(DOCTOR.slice(4));
      const bad = await f.provider.connect({ ...input, patientPhone: "08031234567" });
      expect(JSON.stringify(bad)).not.toContain("8031234567");
      expect(r.data.expiresAtMs - r.data.startedAtMs).toBe(30 * 60_000);
    });

    it("refuses a number that is not international format, two identical numbers, a reference that is not an opaque uuid, and a call length out of range", async () => {
      const f = make();
      for (const bad of [
        { ...input, patientPhone: "08031234567" },
        { ...input, clinicianPhone: "+0123" },
        { ...input, clinicianPhone: PATIENT },
        { ...input, encounterRef: "Ada Okafor review" },
        { ...input, maxMinutes: 0 },
        { ...input, maxMinutes: 1.5 },
        { ...input, maxMinutes: 600 },
      ]) {
        const r = await f.provider.connect(bad);
        expect(r.ok).toBe(false);
        if (!r.ok) expect(r.error.code).toBe("invalid_input");
      }
    });

    it("returns the live bridge when asked again for the same encounter, and a new one for another encounter", async () => {
      const f = make();
      const a = await f.provider.connect(input);
      const b = await f.provider.connect(input);
      const c = await f.provider.connect({ ...input, encounterRef: ENC2 });
      if (!a.ok || !b.ok || !c.ok) throw new Error("connect");
      expect(b.data.bridgeId).toBe(a.data.bridgeId);
      expect(c.data.bridgeId).not.toBe(a.data.bridgeId);
    });

    driven("rings until both have answered, then reports connected", async () => {
      const f = make();
      const r = await f.provider.connect(input);
      if (!r.ok) throw new Error("connect");
      const id = r.data.bridgeId;
      expect(await f.provider.status(id)).toEqual({ ok: true, data: { state: "ringing", patientAnswered: false, clinicianAnswered: false } });
      f.answer!(id, "patient");
      expect(await f.provider.status(id)).toMatchObject({ ok: true, data: { state: "ringing", patientAnswered: true } });
      f.answer!(id, "clinician");
      expect(await f.provider.status(id)).toMatchObject({ ok: true, data: { state: "connected", clinicianAnswered: true } });
    });

    driven("reports failed when a leg cannot be placed", async () => {
      const f = make();
      const r = await f.provider.connect(input);
      if (!r.ok) throw new Error("connect");
      f.failLeg!(r.data.bridgeId);
      expect(await f.provider.status(r.data.bridgeId)).toMatchObject({ ok: true, data: { state: "failed" } });
    });

    it("lets either person or the system hang up, twice is safe, and a hung-up bridge reports ended", async () => {
      const f = make();
      const r = await f.provider.connect(input);
      if (!r.ok) throw new Error("connect");
      for (const who of ["patient", "clinician", "system"] as const) expect((await f.provider.hangup(r.data.bridgeId, who)).ok).toBe(true);
      expect(await f.provider.status(r.data.bridgeId)).toMatchObject({ ok: true, data: { state: "ended" } });
    });

    it("starts a fresh bridge for the encounter after the old one has ended", async () => {
      const f = make();
      const a = await f.provider.connect(input);
      if (!a.ok) throw new Error("connect");
      await f.provider.hangup(a.data.bridgeId, "system");
      const b = await f.provider.connect(input);
      expect(b.ok && b.data.bridgeId).not.toBe(a.data.bridgeId);
    });

    it("answers not_found for an unknown bridge", async () => {
      const f = make();
      for (const r of [await f.provider.status("br_missing"), await f.provider.hangup("br_missing", "system")]) {
        expect(r.ok).toBe(false);
        if (!r.ok) expect(r.error.code).toBe("not_found");
      }
    });

    timed("ends by itself after the maximum length", async () => {
      const f = make();
      const r = await f.provider.connect({ ...input, maxMinutes: 5 });
      if (!r.ok) throw new Error("connect");
      f.advanceMs!(6 * 60_000);
      expect(await f.provider.status(r.data.bridgeId)).toMatchObject({ ok: true, data: { state: "ended" } });
      expect(nowMs()).toBeGreaterThan(0);
    });

    dropped("returns a retryable failure, not an exception, when the vendor cannot be reached", async () => {
      const f = make();
      f.failNextCall!();
      const r = await f.provider.connect(input);
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.error.retryable).toBe(true);
      f.failNextCall!();
      expect((await f.provider.status("br_x")).ok).toBe(false);
      f.failNextCall!();
      expect((await f.provider.hangup("br_x", "system")).ok).toBe(false);
      expect((await f.provider.connect(input)).ok).toBe(true);
    });
  });
}
