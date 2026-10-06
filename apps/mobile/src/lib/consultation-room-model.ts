/**
 * S21 follow-up (OQ-158): pure model for the mobile consultation room. No network, no React, no native modules, so it is proved
 * in Jest. The shapes mirror what the database functions and the two bearer-authenticated web routes return
 * (apps/web/src/components/consultation/consultation-room.tsx's RoomView, apps/web/src/lib/consultations/room.ts's outcomes).
 *
 * NOT run on a real phone: there is no EAS dev-client build for this app yet (OQ-158).
 */

export type EncounterStatus =
  | "scheduled"
  | "waiting"
  | "in_progress"
  | "completed"
  | "no_show_patient"
  | "no_show_clinician"
  | "cancelled"
  | "failed";

/** What consultation_room_view() returns. Nothing in it is a name, a link or a reading. */
export interface RoomView {
  encounter_id: string;
  role: "patient" | "clinician";
  status: EncounterStatus;
  scheduled_at: string;
  final_media_mode: "video" | "audio_only" | "phone" | null;
  join_opens_at: string;
  joinable: boolean;
  patient_joined: boolean;
  clinician_joined: boolean;
  scribe: { asked: boolean; granted: boolean | null };
  can_report_clinician_absent: boolean;
  can_report_patient_absent: boolean;
  clinician_wait_minutes: number;
  reconnect_grace_seconds: number;
}

/** One row of my_upcoming_encounters(). */
export interface UpcomingConsultation {
  encounter_id: string;
  type: "video" | "audio" | "phone" | "async";
  status: EncounterStatus;
  scheduled_at: string;
  appointment_id: string | null;
  final_media_mode: "video" | "audio_only" | "phone" | null;
}

export type RequestedMedia = "video" | "audio_only";

/** The route's answer to a join request. The link is used once to open the Zoom app and is never kept. */
export type JoinResponse =
  | { ok: true; url: string; mediaMode: RequestedMedia; audioOnlyEnforced: boolean; recorded: boolean }
  | { ok: false; reason: "not_found" | "closed" | "provider" }
  | { ok: false; reason: "not_open"; opensAt: string };

export interface DialInInfo {
  numbers: ReadonlyArray<{ number: string }>;
  meetingId: string;
  passcode?: string | null;
}

export type DialInResponse =
  | { ok: true; dialIn: DialInInfo }
  | { ok: false; reason: "not_allowed" | "not_open" | "phone_unavailable" };

/** Low-data rule: never refresh faster than every 10 seconds. */
export const ROOM_POLL_MS = 10_000;

export const LIVE_STATUSES: ReadonlySet<EncounterStatus> = new Set<EncounterStatus>(["scheduled", "waiting", "in_progress"]);

export function isLive(status: EncounterStatus): boolean {
  return LIVE_STATUSES.has(status);
}

/** Clamps any requested interval to the 10 second floor. */
export function pollDelayMs(requested: number): number {
  return Number.isFinite(requested) ? Math.max(ROOM_POLL_MS, requested) : ROOM_POLL_MS;
}

export type RoomPhase = "waiting_room" | "ended" | "cancelled";

export function roomPhase(view: RoomView): RoomPhase {
  if (isLive(view.status)) return "waiting_room";
  return view.status === "cancelled" ? "cancelled" : "ended";
}

/** The patient's own scribe question is asked until they have answered it. */
export function shouldAskScribe(view: RoomView): boolean {
  return view.role === "patient" && isLive(view.status) && view.scribe.granted === null;
}

/** Once they have said yes, they can change their mind; a "no" is final for this consultation. */
export function canWithdrawScribe(view: RoomView): boolean {
  return view.role === "patient" && isLive(view.status) && view.scribe.granted === true;
}

export function isCareTeamIn(view: RoomView): boolean {
  return view.clinician_joined;
}

/** Whether the "join" buttons can be pressed. Once the call has dropped to audio only, video is no longer offered. */
export function joinAvailability(view: RoomView): { video: boolean; audio: boolean } {
  const open = isLive(view.status) && view.joinable;
  return { video: open && view.final_media_mode !== "audio_only", audio: open };
}

/** The server decides the wait rule and sets this flag; the app only shows the button when the server says it may be used. */
export function canTellNobodyCame(view: RoomView): boolean {
  return view.role === "patient" && isLive(view.status) && view.can_report_clinician_absent;
}

/**
 * A tap-to-call link for a published dial-in number. Keeps only a leading plus and digits, so a number formatted with spaces,
 * dashes or brackets still dials, and nothing else can be smuggled into the link. Null when no digits remain.
 */
export function telUrl(number: string): string | null {
  const trimmed = number.trim();
  const digits = trimmed.replace(/\D/g, "");
  if (digits.length < 5) return null;
  return `tel:${trimmed.startsWith("+") ? "+" : ""}${digits}`;
}

const SLOT = {
  timeZone: "Africa/Lagos",
  weekday: "long",
  day: "numeric",
  month: "short",
  hour: "2-digit",
  minute: "2-digit",
} as const;

/** Africa/Lagos, always, whatever the phone's own zone says. */
export function formatWhen(iso: string): string {
  const ms = Date.parse(iso);
  return Number.isNaN(ms) ? "" : new Date(ms).toLocaleString("en-GB", SLOT);
}

/** Narrow runtime checks for what comes back over the network, so a changed server answer reads as an error, not a crash. */
export function parseRoomView(raw: unknown): RoomView | null {
  if (!raw || typeof raw !== "object") return null;
  const v = raw as Partial<RoomView>;
  if (typeof v.encounter_id !== "string" || typeof v.status !== "string" || typeof v.scheduled_at !== "string") return null;
  if (v.role !== "patient" && v.role !== "clinician") return null;
  if (!v.scribe || typeof v.scribe !== "object") return null;
  return raw as RoomView;
}

export function parseUpcoming(raw: unknown): UpcomingConsultation[] | null {
  if (!Array.isArray(raw)) return null;
  const out: UpcomingConsultation[] = [];
  for (const item of raw) {
    if (!item || typeof item !== "object") return null;
    const r = item as Partial<UpcomingConsultation>;
    if (typeof r.encounter_id !== "string" || typeof r.status !== "string" || typeof r.scheduled_at !== "string") return null;
    out.push(item as UpcomingConsultation);
  }
  return out;
}
