import type { DialIn, RequestedMedia, VideoProvider, VideoRole } from "@tarragon/integrations";

/**
 * S21: the server side of a consultation room. Pure logic over injected clients so it can be proved end to end against the
 * mock providers (room.test.ts) without a network or a database. The Next.js actions in
 * app/(dashboard)/{patient,clinician}/consultation/[encounterId]/ wire the real clients in.
 *
 * Two database clients, on purpose:
 *  - `userRpc` is the signed-in person's own session. Everything that records what THEY did (joined, asked for phone, no-show)
 *    goes through it, so the database functions see auth.uid() and enforce who may do what (INV-12).
 *  - `serviceRpc` is the service client. It only reads the room and opens it (functions granted to service_role alone), and is
 *    only reached after this module has checked the signed-in person against the encounter.
 *
 * No join or host link is ever stored. A link is fetched from the vendor for the person who is joining, handed to them, and
 * dropped (OQ-126, OQ-128). Nothing here puts a name, a reading or a condition in a vendor call or a log.
 */
export type RpcClient = {
  rpc: (fn: string, args?: Record<string, unknown>) => PromiseLike<{ data: unknown; error: { message: string; code?: string } | null }>;
};

export interface RoomDeps {
  readonly userId: string;
  readonly userRpc: RpcClient;
  readonly serviceRpc: RpcClient;
  readonly video: VideoProvider;
  readonly now: () => number;
}

interface RoomView {
  encounter_id: string;
  patient_id: string;
  clinician_id: string | null;
  status: string;
  final_media_mode: "video" | "audio_only" | "phone" | null;
  join_opens_at: string;
  join_closes_at: string;
  joinable: boolean;
  session_minutes: number;
  room: { provider: "zoom" | "mock"; provider_room_id: string | null; state: string; expires_at: string | null } | null;
}

export type JoinOutcome =
  | { ok: true; url: string; mediaMode: RequestedMedia; audioOnlyEnforced: boolean; recorded: boolean }
  | { ok: false; reason: "not_found" | "closed" | "provider" }
  | { ok: false; reason: "not_open"; opensAt: string };

const DONE = new Set(["completed", "no_show_patient", "no_show_clinician", "cancelled", "failed"]);

async function lookup(deps: RoomDeps, encounterId: string): Promise<{ view: RoomView; role: VideoRole } | null> {
  const res = await deps.serviceRpc.rpc("service_get_encounter_room", { p_encounter: encounterId });
  const view = res.error ? null : (res.data as RoomView | null);
  if (!view) return null;
  // The signed-in person must be one of the two people on this consultation. Anyone else gets the same answer as an
  // unknown id, so an id cannot be used to find out whether a consultation exists.
  const role: VideoRole | null = deps.userId === view.patient_id ? "patient" : deps.userId === view.clinician_id ? "clinician" : null;
  return role ? { view, role } : null;
}

/** The vendor room for this consultation, created and recorded on first use. Null when the vendor or the database refused. */
async function ensureRoom(deps: RoomDeps, view: RoomView, encounterId: string): Promise<string | null> {
  const existing = view.room?.provider_room_id ?? null;
  if (existing) return existing;
  const created = await deps.video.createRoom({ encounterRef: encounterId, expiresAtMs: Date.parse(view.join_closes_at) });
  if (!created.ok) return null;
  const opened = await deps.serviceRpc.rpc("service_open_encounter_room", {
    p_encounter: encounterId,
    p_provider: deps.video.name === "zoom" ? "zoom" : "mock",
    p_room_id: created.data.roomId,
    p_expires_at: new Date(created.data.expiresAtMs).toISOString(),
  });
  const row = opened.error ? null : (opened.data as { provider_room_id: string; created: boolean } | null);
  if (!row) return null;
  // Two people opened the room at once and the other won: end ours so no orphan meeting is left open.
  if (!row.created) await deps.video.endRoom(created.data.roomId, "clinician");
  return row.provider_room_id;
}

/** Opens the room if it is not open yet and returns the person's own link. Never stores the link. */
export async function joinConsultation(deps: RoomDeps, encounterId: string, requested: RequestedMedia): Promise<JoinOutcome> {
  const found = await lookup(deps, encounterId);
  if (!found) return { ok: false, reason: "not_found" };
  const { view, role } = found;
  if (DONE.has(view.status)) return { ok: false, reason: "closed" };
  if (!view.joinable) return { ok: false, reason: "not_open", opensAt: view.join_opens_at };

  const roomId = await ensureRoom(deps, view, encounterId);
  if (!roomId) return { ok: false, reason: "provider" };

  // Once a call has dropped to audio only, anyone who rejoins comes in audio first.
  const mediaMode: RequestedMedia = view.final_media_mode === "audio_only" ? "audio_only" : requested;
  const link = await deps.video.joinLink({ roomId, role, mediaMode });
  if (!link.ok) return { ok: false, reason: "provider" };

  // The server records the join (a person cannot vouch for their own presence), after the window and the person were checked.
  const recorded = !(await deps.serviceRpc.rpc("service_record_join", { p_encounter: encounterId, p_role: role, p_mode: mediaMode })).error;
  return { ok: true, url: link.data.url, mediaMode, audioOnlyEnforced: link.data.audioOnlyEnforced, recorded };
}

/** What a person needs to ring into the same room. Held in memory for the page view only; never stored or logged. */
export type DialInOutcome =
  | { ok: true; dialIn: Pick<DialIn, "numbers" | "meetingId" | "passcode"> }
  | { ok: false; reason: "not_allowed" | "not_open" | "phone_unavailable" };

/** The country the patient dials in from. This platform serves Nigeria only. */
const DIAL_IN_COUNTRY = "NG";

/**
 * The last step of the ladder (OQ-131 revised): join the SAME room by an ordinary phone call, which needs no data and no app. Either
 * person can ask at any time inside the join window. Nothing is rung from our side and no number of anyone's is held: the person
 * dials a number the vendor publishes and types the meeting id and passcode. We cannot see whether they dialled, so the consultation
 * is never marked as "on the phone" here; the clinician stays in the room and admits the caller.
 */
export async function requestDialIn(deps: RoomDeps, encounterId: string): Promise<DialInOutcome> {
  const found = await lookup(deps, encounterId);
  if (!found) return { ok: false, reason: "not_allowed" };
  const { view } = found;
  if (!view.clinician_id || DONE.has(view.status)) return { ok: false, reason: "not_allowed" };
  // Only inside the join window: the room is not opened days early or after the visit.
  if (!view.joinable) return { ok: false, reason: "not_open" };

  // Recorded as the person's own request, so the database sees who asked and enforces who may (INV-12).
  const asked = await deps.userRpc.rpc("report_encounter_event", { p_encounter: encounterId, p_kind: "phone_requested", p_payload: {} });
  if (asked.error) return { ok: false, reason: "not_allowed" };

  const roomId = await ensureRoom(deps, view, encounterId);
  const dial = roomId ? await deps.video.dialIn({ roomId, country: DIAL_IN_COUNTRY }) : null;
  if (!dial || !dial.ok) {
    // The reason is a code, never a number or a vendor message.
    await deps.serviceRpc.rpc("service_record_encounter_event", { p_encounter: encounterId, p_kind: "phone_requested", p_actor_role: "system", p_payload: { reason_code: "dial_in_unavailable" } });
    return { ok: false, reason: "phone_unavailable" };
  }
  return { ok: true, dialIn: { numbers: dial.data.numbers, meetingId: dial.data.meetingId, passcode: dial.data.passcode } };
}
