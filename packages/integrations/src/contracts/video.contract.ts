import { describe, expect, it } from "@jest/globals";
import type { VideoEvent, VideoProvider } from "../../../../supabase/functions/_shared/integrations/index.ts";

export interface VideoFixture {
  readonly provider: VideoProvider;
  /** Moves the fixture's clock forward. Absent for a live vendor. */
  advanceMs?(ms: number): void;
  emit?(event: VideoEvent): void;
  failNextCall?(): void;
  /** Vendor-shaped, correctly signed webhooks. Absent for a live vendor. */
  webhook?: {
    roomEnded(roomId: string): Promise<{ rawBody: string; headers: Record<string, string> }>;
    joined(roomId: string, label: string): Promise<{ rawBody: string; headers: Record<string, string> }>;
    left(roomId: string, label: string): Promise<{ rawBody: string; headers: Record<string, string> }>;
    other(roomId: string): Promise<{ rawBody: string; headers: Record<string, string> }>;
    /** The same body with a signature that does not belong to it. */
    forged(roomId: string): Promise<{ rawBody: string; headers: Record<string, string> }>;
  };
}

const ENC = "7b9c2f0e-5d3a-4c11-9a52-0f6d1e8b7a44";
const PERSON = "2f4b8c1d-9e07-4a63-b5d2-6c8e0a1f3d97";

export function runVideoContract(name: string, make: () => VideoFixture, nowMs: () => number = () => Date.now()): void {
  const probe = make();
  const canAdvance = probe.advanceMs !== undefined;
  const canEmit = probe.emit !== undefined;
  const canFail = probe.failNextCall !== undefined;
  const timed = canAdvance ? it : it.skip;
  const evented = canEmit ? it : it.skip;
  const dropped = canFail ? it : it.skip;
  const hooked = probe.webhook !== undefined ? it : it.skip;

  describe(`VideoProvider contract: ${name}`, () => {
    it("creates an opaque room: nothing from the encounter or a person appears in its id", async () => {
      const f = make();
      const r = await f.provider.createRoom({ encounterRef: ENC, expiresAtMs: nowMs() + 3_600_000 });
      expect(r.ok).toBe(true);
      if (!r.ok) return;
      expect(r.data.roomId).not.toContain(ENC);
      expect(r.data.roomId).not.toMatch(/patient|clinician|bp|pressure|dr\./i);
    });

    it("refuses a room whose encounter reference is not an opaque uuid, or that has already expired", async () => {
      const f = make();
      const named = await f.provider.createRoom({ encounterRef: "Ada Okafor hypertension review", expiresAtMs: nowMs() + 3_600_000 });
      const past = await f.provider.createRoom({ encounterRef: ENC, expiresAtMs: nowMs() - 1 });
      expect(named.ok).toBe(false);
      expect(past.ok).toBe(false);
    });

    it("asserts that recording is off (OQ-128)", async () => {
      const f = make();
      const r = await f.provider.createRoom({ encounterRef: ENC, expiresAtMs: nowMs() + 3_600_000 });
      expect(r.ok && r.data.recording).toBe("off");
    });

    it("issues a join link that never carries the encounter or a person, and gives the clinician a different link from the patient", async () => {
      const f = make();
      const room = await f.provider.createRoom({ encounterRef: ENC, expiresAtMs: nowMs() + 600_000 });
      if (!room.ok) throw new Error("room");
      const pat = await f.provider.joinLink({ roomId: room.data.roomId, role: "patient", mediaMode: "video" });
      const doc = await f.provider.joinLink({ roomId: room.data.roomId, role: "clinician", mediaMode: "audio_only" });
      expect(pat.ok && doc.ok).toBe(true);
      if (!pat.ok || !doc.ok) return;
      expect(pat.data.url).toMatch(/^https:\/\//);
      expect(pat.data.url).not.toContain(ENC);
      expect(pat.data.url).not.toBe(doc.data.url);
      expect(pat.data.expiresAtMs).toBeLessThanOrEqual(room.data.expiresAtMs);
      expect(pat.data.mediaMode).toBe("video");
      expect(pat.data.audioOnlyEnforced).toBe(false);
      expect(doc.data.mediaMode).toBe("audio_only");
      expect(typeof doc.data.audioOnlyEnforced).toBe("boolean");
    });

    it("refuses a join link for an unknown room or a closed one", async () => {
      const f = make();
      expect((await f.provider.joinLink({ roomId: "room_missing", role: "patient", mediaMode: "video" })).ok).toBe(false);
      const room = await f.provider.createRoom({ encounterRef: ENC, expiresAtMs: nowMs() + 600_000 });
      if (!room.ok) throw new Error("room");
      await f.provider.endRoom(room.data.roomId, "clinician");
      expect((await f.provider.joinLink({ roomId: room.data.roomId, role: "patient", mediaMode: "video" })).ok).toBe(false);
    });

    it("gives Nigerian dial-in numbers, the meeting id and a keypad passcode for the same room, and nothing about a person", async () => {
      const f = make();
      const room = await f.provider.createRoom({ encounterRef: ENC, expiresAtMs: nowMs() + 600_000 });
      if (!room.ok) throw new Error("room");
      const d = await f.provider.dialIn({ roomId: room.data.roomId, country: "NG" });
      expect(d.ok).toBe(true);
      if (!d.ok) return;
      expect(d.data.numbers.length).toBeGreaterThan(0);
      expect(d.data.numbers.every((n) => n.country === "NG" && /^\+?[0-9 ]{8,}$/.test(n.number))).toBe(true);
      expect(d.data.meetingId).toMatch(/^\d{9,12}$/);
      expect(d.data.passcode === null || /^\d{4,10}$/.test(d.data.passcode)).toBe(true);
      expect(d.data.expiresAtMs).toBeLessThanOrEqual(room.data.expiresAtMs);
      expect(JSON.stringify(d.data)).not.toContain(ENC);
    });

    it("refuses dial-in for an unknown room, a closed room, or a country with no number", async () => {
      const f = make();
      expect((await f.provider.dialIn({ roomId: "room_missing", country: "NG" })).ok).toBe(false);
      const room = await f.provider.createRoom({ encounterRef: ENC, expiresAtMs: nowMs() + 600_000 });
      if (!room.ok) throw new Error("room");
      expect(await f.provider.dialIn({ roomId: room.data.roomId, country: "ZZ" })).toMatchObject({ ok: false, error: { code: "not_found" } });
      await f.provider.endRoom(room.data.roomId, "clinician");
      expect((await f.provider.dialIn({ roomId: room.data.roomId, country: "NG" })).ok).toBe(false);
    });

    timed("refuses a join link once the room has expired", async () => {
      const f = make();
      const room = await f.provider.createRoom({ encounterRef: ENC, expiresAtMs: nowMs() + 1000 });
      if (!room.ok) throw new Error("room");
      f.advanceMs!(7_200_000);
      expect((await f.provider.joinLink({ roomId: room.data.roomId, role: "patient", mediaMode: "video" })).ok).toBe(false);
    });

    it("issues a short-lived token that never outlives the room", async () => {
      const f = make();
      const room = await f.provider.createRoom({ encounterRef: ENC, expiresAtMs: nowMs() + 600_000 });
      if (!room.ok) throw new Error("room");
      const t = await f.provider.joinToken({ roomId: room.data.roomId, role: "patient", identity: PERSON, ttlSeconds: 3600 });
      expect(t.ok).toBe(true);
      if (!t.ok) return;
      expect(t.data.expiresAtMs).toBeLessThanOrEqual(room.data.expiresAtMs);
      expect(t.data.token).not.toContain(PERSON);
    });

    it("refuses a token for an unknown room, a bad identity or a lifetime out of range", async () => {
      const f = make();
      const room = await f.provider.createRoom({ encounterRef: ENC, expiresAtMs: nowMs() + 600_000 });
      if (!room.ok) throw new Error("room");
      expect((await f.provider.joinToken({ roomId: "room_missing", role: "patient", identity: PERSON, ttlSeconds: 60 })).ok).toBe(false);
      expect((await f.provider.joinToken({ roomId: room.data.roomId, role: "patient", identity: "Ada", ttlSeconds: 60 })).ok).toBe(false);
      for (const ttlSeconds of [0, -5, 1.5, 99_999]) {
        expect((await f.provider.joinToken({ roomId: room.data.roomId, role: "patient", identity: PERSON, ttlSeconds })).ok).toBe(false);
      }
    });

    it("lets only a clinician end a room, ends it once, and refuses new tokens afterwards", async () => {
      const f = make();
      const room = await f.provider.createRoom({ encounterRef: ENC, expiresAtMs: nowMs() + 600_000 });
      if (!room.ok) throw new Error("room");
      const id = room.data.roomId;
      for (const role of ["patient", "observer"] as const) {
        const denied = await f.provider.endRoom(id, role);
        expect(denied.ok).toBe(false);
        if (!denied.ok) expect(denied.error.code).toBe("unauthorized");
      }
      expect((await f.provider.joinToken({ roomId: id, role: "patient", identity: PERSON, ttlSeconds: 60 })).ok).toBe(true);
      const ended = await f.provider.endRoom(id, "clinician");
      expect(ended.ok).toBe(true);
      expect((await f.provider.endRoom(id, "clinician")).ok).toBe(true);
      expect((await f.provider.joinToken({ roomId: id, role: "patient", identity: PERSON, ttlSeconds: 60 })).ok).toBe(false);
      expect((await f.provider.endRoom("room_missing", "clinician")).ok).toBe(false);
    });

    timed("refuses a token once the room has expired", async () => {
      const f = make();
      const room = await f.provider.createRoom({ encounterRef: ENC, expiresAtMs: nowMs() + 1000 });
      if (!room.ok) throw new Error("room");
      f.advanceMs!(7_200_000);
      expect((await f.provider.joinToken({ roomId: room.data.roomId, role: "patient", identity: PERSON, ttlSeconds: 60 })).ok).toBe(false);
    });

    evented("delivers connection and presence events to subscribers until they unsubscribe", async () => {
      const f = make();
      const room = await f.provider.createRoom({ encounterRef: ENC, expiresAtMs: nowMs() + 600_000 });
      if (!room.ok) throw new Error("room");
      const id = room.data.roomId;
      const seen: VideoEvent[] = [];
      const off = f.provider.subscribe(id, (e) => seen.push(e));
      f.emit!({ kind: "participant_joined", roomId: id, role: "patient", atMs: 1 });
      f.emit!({ kind: "quality", roomId: id, role: "patient", atMs: 2, quality: "poor", bitrateKbps: 40 });
      off();
      f.emit!({ kind: "participant_left", roomId: id, role: "patient", atMs: 3 });
      expect(seen.map((e) => e.kind)).toEqual(["participant_joined", "quality"]);
      await f.provider.endRoom(id, "clinician");
    });

    hooked("maps presence and room-end webhooks to our events, by role label and never by name", async () => {
      const f = make();
      const now = nowMs();
      const w = f.webhook!;
      const ended = await w.roomEnded("123456789");
      const e = await f.provider.parseWebhook(ended.rawBody, ended.headers, now);
      expect(e.ok && e.data).toMatchObject({ kind: "room_ended", roomId: "123456789" });
      const j = await w.joined("123456789", "patient");
      const joined = await f.provider.parseWebhook(j.rawBody, j.headers, now);
      expect(joined.ok && joined.data).toMatchObject({ kind: "participant_joined", roomId: "123456789", role: "patient" });
      const l = await w.left("123456789", "clinician");
      const left = await f.provider.parseWebhook(l.rawBody, l.headers, now);
      expect(left.ok && left.data).toMatchObject({ kind: "participant_left", role: "clinician" });
    });

    hooked("ignores events it does not act on, including a participant whose label is not a role", async () => {
      const f = make();
      const w = f.webhook!;
      const other = await w.other("123456789");
      expect((await f.provider.parseWebhook(other.rawBody, other.headers, nowMs()))).toEqual({ ok: true, data: null });
      const named = await w.joined("123456789", "Ada Okafor");
      expect((await f.provider.parseWebhook(named.rawBody, named.headers, nowMs()))).toEqual({ ok: true, data: null });
    });

    hooked("rejects a webhook with a missing or forged signature", async () => {
      const f = make();
      const ok = await f.webhook!.roomEnded("123456789");
      const forged = await f.webhook!.forged("123456789");
      for (const h of [{}, forged.headers]) {
        const r = await f.provider.parseWebhook(ok.rawBody, h, nowMs());
        expect(r.ok).toBe(false);
        if (!r.ok) expect(r.error.code).toBe("invalid_signature");
      }
    });

    dropped("returns a retryable failure, not an exception, when the vendor cannot be reached", async () => {
      const f = make();
      f.failNextCall!();
      const r = await f.provider.createRoom({ encounterRef: ENC, expiresAtMs: nowMs() + 600_000 });
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.error.retryable).toBe(true);
      expect((await f.provider.createRoom({ encounterRef: ENC, expiresAtMs: nowMs() + 600_000 })).ok).toBe(true);
    });
  });
}
