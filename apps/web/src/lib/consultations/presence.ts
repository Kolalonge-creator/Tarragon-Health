import { hmacHex, isSafeWebhookChallenge, roleFromParticipantKey, type VideoProvider } from "@tarragon/integrations";
import type { RpcClient } from "./room";

/**
 * S21 follow-up (OQ-160): real presence from the vendor's own webhook.
 *
 * Before this, "joined" was recorded when a person was given the way in, so a clinician who asked for the link and never entered
 * still counted as present. Now, once the webhook is live, a join is recorded only when the VENDOR says someone entered the room.
 *
 * Who entered is the one thing that must not come from the client: a person chooses their own display name, so a patient could call
 * themselves "clinician". So the label is ignored here. The participant joined the vendor's SDK with an opaque key the server
 * minted for (encounter, role) (participantKey in @tarragon/integrations), the vendor hands it back as `customer_key`, and only a key
 * that verifies for the encounter the room belongs to counts. A person who joined by plain link or by phone carries no key and so
 * proves nothing: they stay on the older, weaker path and never write presence here.
 *
 * A webhook cannot say how the person joined (video or audio), so the join is recorded with mode "unknown"; the mode_changed events carry the real one.
 *
 * Pure logic over injected clients, so it is proved without a network (presence.test.ts). The Next route is a thin wrapper.
 */
export interface PresenceDeps {
  readonly video: VideoProvider;
  /** Service-role client: the only caller of the presence functions. */
  readonly serviceRpc: RpcClient;
  /** The consultation whose vendor room this is, or null when the room is not ours (a visit from the older flow). */
  readonly encounterForRoom: (roomId: string) => Promise<{ encounterId: string } | null | "error">;
  /** The server-only secret participant keys are minted with. */
  readonly participantKeySecret: string | null;
  /** The vendor's endpoint-validation secret, for the one-time handshake that activates the subscription. */
  readonly webhookSecretToken: string | null;
  readonly now: () => number;
  /** Ids and codes only. Never a name, a key or a payload. */
  readonly log: (message: string) => void;
}

export interface PresenceResponse {
  readonly status: number;
  readonly body: Record<string, unknown>;
}

/** Database errors that mean "this event cannot be recorded, and retrying will not change that" (outside the window, no such consultation). */
const FINAL_CODES = new Set(["P0001", "P0002", "22023"]);


const respond = (status: number, body: Record<string, unknown>): PresenceResponse => ({ status, body });

export async function handleVideoWebhook(deps: PresenceDeps, rawBody: string, headers: Readonly<Record<string, string | null>>): Promise<PresenceResponse> {
  // The vendor's one-time URL handshake. Its answer is an HMAC under the same secret that signs real events, so plainTokenFrom only
  // accepts a challenge that cannot be a signed message (see isSafeWebhookChallenge).
  const challenge = plainTokenFrom(rawBody);
  if (challenge !== null) {
    if (!deps.webhookSecretToken) return respond(503, { error: "not_configured" });
    return respond(200, { plainToken: challenge, encryptedToken: await hmacHex("SHA-256", deps.webhookSecretToken, challenge) });
  }

  const parsed = await deps.video.parseWebhook(rawBody, headers, deps.now());
  if (!parsed.ok) {
    const code = parsed.error.code;
    // A genuine event that came late (an outage, a slow retry) is acknowledged: a 401 would make the vendor count this endpoint as failing.
    // Presence for it is lost, but the DB refuses a join outside the window anyway, and the log says it happened.
    if (code === "stale_event") {
      deps.log("zoom presence: a correctly signed event arrived outside the replay window and was ignored");
      return respond(200, { handled: false, reason: "stale" });
    }
    return respond(code === "invalid_signature" ? 401 : code === "not_configured" ? 503 : 400, { error: code });
  }
  const event = parsed.data;
  // Not an event we act on. Acknowledged so the vendor does not retry it.
  if (!event || (event.kind !== "participant_joined" && event.kind !== "participant_left")) return respond(200, { handled: false });

  const room = await deps.encounterForRoom(event.roomId);
  if (room === "error") {
    deps.log("zoom presence: could not look up the room");
    return respond(500, { error: "lookup_failed" });
  }
  // Rooms of the older visit flow share the account, so an unknown room is ordinary and not logged.
  if (!room) return respond(200, { handled: false, reason: "unknown_room" });
  if (!event.customerKey) {
    // A link or phone joiner never carries a key. But if EVERY event for our own consultations takes this path, the vendor is not sending
    // the key back (or the SDK is not passing it), and presence is silently doing nothing: this line, per event, is how that shows up.
    deps.log(`zoom presence: ${event.kind} without a participant key for encounter ${room.encounterId}`);
    return respond(200, { handled: false, reason: "no_key" });
  }
  if (!deps.participantKeySecret) return respond(503, { error: "not_configured" });

  const role = await roleFromParticipantKey(deps.participantKeySecret, room.encounterId, event.customerKey);
  if (!role) {
    // Someone presented a key that is not ours for this consultation. Nothing is recorded; the id is enough to look into it.
    deps.log(`zoom presence: key did not verify for encounter ${room.encounterId}`);
    return respond(200, { handled: false, reason: "key_mismatch" });
  }

  const res =
    event.kind === "participant_joined"
      ? await deps.serviceRpc.rpc("service_record_join", { p_encounter: room.encounterId, p_role: role, p_mode: "unknown" })
      : await deps.serviceRpc.rpc("service_record_encounter_event", { p_encounter: room.encounterId, p_kind: "left", p_actor_role: role, p_payload: {} });
  if (res.error) {
    const final = res.error.code !== undefined && FINAL_CODES.has(res.error.code);
    deps.log(`zoom presence: ${event.kind} for encounter ${room.encounterId} was ${final ? "refused" : "not saved"} (${res.error.code ?? "no code"})`);
    // A refusal the database will always repeat is acknowledged; anything else is asked to be retried so presence is not lost.
    return final ? respond(200, { handled: false, reason: "refused" }) : respond(500, { error: "record_failed" });
  }
  return respond(200, { handled: true, kind: event.kind, role });
}

function plainTokenFrom(rawBody: string): string | null {
  try {
    const json: unknown = JSON.parse(rawBody);
    if (typeof json !== "object" || json === null) return null;
    const root = json as Record<string, unknown>;
    const payload = root["payload"];
    const token = typeof payload === "object" && payload !== null ? (payload as Record<string, unknown>)["plainToken"] : undefined;
    return root["event"] === "endpoint.url_validation" && typeof token === "string" && isSafeWebhookChallenge(token) ? token : null;
  } catch {
    return null;
  }
}
