import { constantTimeEqual, hmacHex } from "./crypto.ts";
import { isUuid } from "./ids.ts";
import { fail, ok } from "./result.ts";
import { asVideoRole, MAX_TOKEN_TTL_SECONDS, type VideoEvent, type VideoProvider, type VideoRole } from "./video.ts";

export interface MockVideoControl {
  /** Delivers an event to subscribers, as the vendor's SDK or webhook would. */
  emit(event: VideoEvent): void;
  failNextCall(): void;
  /** A webhook body and headers the mock accepts, in the mock's own simple shape. */
  signedEvent(body: { type: "participant_joined" | "participant_left" | "room_ended" | "other"; roomId: string; label?: string; customerKey?: string }): Promise<{ rawBody: string; headers: Record<string, string> }>;
}

const MOCK_SECRET = "mock-video-webhook-secret";

export function createMockVideo(now: () => number = () => Date.now()): VideoProvider & MockVideoControl {
  const rooms = new Map<string, { expiresAtMs: number; ended: boolean }>();
  const handlers = new Map<string, Set<(e: VideoEvent) => void>>();
  let failNext = false;
  let seq = 0;

  const dropped = () => {
    if (!failNext) return null;
    failNext = false;
    return fail("network", "Could not reach the vendor");
  };

  const emit = (event: VideoEvent) => {
    for (const h of handlers.get(event.roomId) ?? []) h(event);
  };

  return {
    name: "mock",
    isMock: true,

    emit,
    failNextCall() {
      failNext = true;
    },
    async signedEvent(body) {
      const rawBody = JSON.stringify(body);
      return { rawBody, headers: { "x-mock-signature": await hmacHex("SHA-256", MOCK_SECRET, rawBody) } };
    },

    async createRoom(input) {
      const d = dropped();
      if (d) return d;
      if (!isUuid(input.encounterRef)) return fail("invalid_input", "Encounter reference must be an opaque uuid");
      if (!Number.isFinite(input.expiresAtMs) || input.expiresAtMs <= now()) return fail("invalid_input", "Room expiry must be in the future");
      seq += 1;
      // Opaque on purpose: nothing derived from the encounter or a person.
      const roomId = `room_${seq.toString(36)}_${Math.floor(now() % 1_000_000).toString(36)}`;
      rooms.set(roomId, { expiresAtMs: input.expiresAtMs, ended: false });
      return ok({ roomId, expiresAtMs: input.expiresAtMs, recording: "off" });
    },

    async joinToken(input) {
      const d = dropped();
      if (d) return d;
      const room = rooms.get(input.roomId);
      if (!room) return fail("not_found", "No such room", false);
      if (room.ended || room.expiresAtMs <= now()) return fail("conflict", "Room is closed", false);
      if (!isUuid(input.identity)) return fail("invalid_input", "Identity must be an opaque uuid");
      if (input.hostKeyTtlSeconds !== undefined && (!Number.isInteger(input.hostKeyTtlSeconds) || input.hostKeyTtlSeconds <= 0 || input.hostKeyTtlSeconds > MAX_TOKEN_TTL_SECONDS)) {
        return fail("invalid_input", "Host key lifetime is out of range");
      }
      if (!Number.isInteger(input.ttlSeconds) || input.ttlSeconds <= 0 || input.ttlSeconds > MAX_TOKEN_TTL_SECONDS) {
        return fail("invalid_input", "Token lifetime is out of range");
      }
      // A token never outlives the room.
      const expiresAtMs = Math.min(now() + input.ttlSeconds * 1000, room.expiresAtMs);
      return ok({ token: `mocktoken.${input.roomId}.${input.role}.${expiresAtMs}`, expiresAtMs, password: "mockpass", ...(input.role === "clinician" ? { zak: "mockzak" } : {}) });
    },

    async joinLink(input) {
      const d = dropped();
      if (d) return d;
      const room = rooms.get(input.roomId);
      if (!room) return fail("not_found", "No such room", false);
      if (room.ended || room.expiresAtMs <= now()) return fail("conflict", "Room is closed", false);
      // The mock models a vendor SDK that can keep the camera off.
      return ok({
        url: `https://video.mock.invalid/r/${input.roomId}?as=${input.role}&media=${input.mediaMode}`,
        expiresAtMs: room.expiresAtMs,
        mediaMode: input.mediaMode,
        audioOnlyEnforced: input.mediaMode === "audio_only",
      });
    },

    async dialIn(input) {
      const d = dropped();
      if (d) return d;
      const room = rooms.get(input.roomId);
      if (!room) return fail("not_found", "No such room", false);
      if (room.ended || room.expiresAtMs <= now()) return fail("conflict", "Room is closed", false);
      if (input.country !== "NG") return fail("not_found", "No dial-in number for this country", false);
      return ok({ numbers: [{ country: "NG", number: "+234 000 000 0000", city: "Lagos", kind: "toll" as const }], meetingId: "000000000", passcode: "0000", expiresAtMs: room.expiresAtMs });
    },

    async endRoom(roomId, actingRole: VideoRole) {
      const d = dropped();
      if (d) return d;
      const room = rooms.get(roomId);
      if (!room) return fail("not_found", "No such room", false);
      if (actingRole !== "clinician") return fail("unauthorized", "Only a clinician can end a consultation", false);
      const endedAtMs = now();
      // Ending twice is safe and reports the same outcome.
      if (!room.ended) {
        room.ended = true;
        emit({ kind: "room_ended", roomId, atMs: endedAtMs });
      }
      return ok({ endedAtMs });
    },

    async parseWebhook(rawBody, headers, nowMs) {
      const sig = headers["x-mock-signature"];
      if (!sig || !constantTimeEqual(sig, await hmacHex("SHA-256", MOCK_SECRET, rawBody))) return fail("invalid_signature", "Signature does not match", false);
      let body: { type?: string; roomId?: string; label?: string; customerKey?: string };
      try {
        body = JSON.parse(rawBody) as { type?: string; roomId?: string; label?: string; customerKey?: string };
      } catch {
        return fail("bad_response", "Webhook body is not JSON", false);
      }
      const roomId = body.roomId;
      if (typeof roomId !== "string") return ok(null);
      if (body.type === "room_ended") return ok({ kind: "room_ended", roomId, atMs: nowMs });
      const customerKey = typeof body.customerKey === "string" && body.customerKey.length > 0 ? body.customerKey : undefined;
      const role = asVideoRole(body.label) ?? (customerKey ? "observer" : null);
      if ((body.type === "participant_joined" || body.type === "participant_left") && role) return ok({ kind: body.type, roomId, role, atMs: nowMs, ...(customerKey ? { customerKey } : {}) });
      return ok(null);
    },

    subscribe(roomId, handler) {
      const set = handlers.get(roomId) ?? new Set();
      set.add(handler);
      handlers.set(roomId, set);
      return () => {
        set.delete(handler);
      };
    },
  };
}
