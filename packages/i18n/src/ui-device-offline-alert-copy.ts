/**
 * Words for three small patient-facing patterns (UI-C, from docs/research/S66-S70-design-ui-comparison.md section 4, changes 7, 9, 10, 12):
 *
 *   - device rows with a three-state sync line and a last-synced time in words (change 9),
 *   - the "Saved on this phone" note and queue badge on log buttons (change 10),
 *   - the standard alert template: what we noticed, what it may mean, one step, a message-your-care-team button (change 12).
 *
 * Voice: warm, no fear words, no exclamation marks, no em dashes, "your care team" and never "your doctor". A lint test
 * (packages/shared/src/copy-lint/alert-tone-lint.test.ts) holds the tone rules. The two `alerttpl.preg.*` meaning lines state a
 * clinical idea in pregnancy and are PROPOSED copy awaiting CMO review (see UI_C_COPY_REVIEW); nobody but the CMO marks them reviewed.
 */
export const uiDeviceOfflineAlertCopy = {
  // --- change 9: three-state sync line on every device row
  "devicesync.state.working": "Working",
  "devicesync.state.needs_fix": "Needs a quick fix",
  "devicesync.state.not_set_up": "Not set up",
  "devicesync.state.waiting": "Waiting for the first reading",
  "devicesync.state.paused": "Paused",
  "devicesync.explain.working": "Readings are arriving as expected.",
  "devicesync.explain.needs_fix": "Readings have stopped arriving. A quick fix usually sorts it out.",
  "devicesync.explain.stale": "No readings since {date}. A quick fix usually sorts it out.",
  "devicesync.explain.not_set_up": "This one is not connected yet.",
  "devicesync.explain.waiting": "It is set up, but no reading has reached us yet. Take a reading with it to get started.",
  "devicesync.explain.paused": "Sharing from this one is paused. You can resume it any time.",
  "devicesync.last.label": "Last synced",
  "devicesync.last.never": "Not synced yet",
  "devicesync.last.just_now": "Just now",
  "devicesync.last.today": "Today at {time}",
  "devicesync.last.yesterday": "Yesterday at {time}",
  "devicesync.last.days": "{days} days ago",
  "devicesync.last.weeks": "{weeks} weeks ago",
  "devicesync.last.long": "More than 2 months ago",
  "devicesync.fix.needs_fix": "Fix this",
  "devicesync.fix.not_set_up": "Set it up",
  "devicesync.fix.paused": "Resume",
  "devicesync.fix.hint": "Opens the steps to get this device sending readings again.",

  // --- change 10: saved-offline note and queue badge on log buttons
  "offline.saved_note": "Saved on this phone. It will send when you are online.",
  "offline.queue_badge": "{count} waiting to send",

  // --- change 12: the standard alert template
  "alerttpl.label.noticed": "What we noticed",
  "alerttpl.label.meaning": "What it may mean",
  "alerttpl.label.step": "One step to take",
  "alerttpl.message_care_team": "Message your care team",
  "alerttpl.message_care_team_hint": "Opens a message to your care team.",
  "alerttpl.preg.check.noticed": "You ticked a sign that needs a check.",
  "alerttpl.preg.contact_today.meaning": "Some signs in pregnancy are worth a prompt check, even when you feel well.",
  "alerttpl.preg.go_now.meaning": "Some signs in pregnancy need care straight away.",
} as const;

export const UI_C_COPY_REVIEW = {
  status: "pending_cmo_review",
  owner: "CMO",
  /** Only these two lines say something clinical; everything else in the file is interface wording. */
  clinicalKeys: ["alerttpl.preg.contact_today.meaning", "alerttpl.preg.go_now.meaning"],
  source: "docs/research/S66-S70-design-ui-comparison.md",
  prefixes: ["devicesync.", "offline.", "alerttpl."],
} as const;

export type DeviceSyncState = "working" | "needs_fix" | "stale" | "waiting" | "paused" | "not_set_up";

export interface DeviceSyncInput {
  /** patient_devices.status (active, unpaired) or wearable_connections.status (active, disconnected, error, paused). */
  status: string | null | undefined;
  /** The last error the sync path recorded, if any. */
  lastSyncError?: string | null;
  /** ISO time of the last successful sync, if any. */
  lastSyncedAt?: string | null;
}

/**
 * The state of a device or connection, read from fields the sync path already records.
 *   not_set_up  unpaired or disconnected
 *   paused      the person paused it (shown as "Paused", never "Not set up")
 *   needs_fix   an error status or a recorded sync error
 *   waiting     set up, no reading has ever arrived (never claims readings are arriving)
 *   stale       set up, but the last sync is older than `staleAfterDays`
 *   working     set up, no error, synced within `staleAfterDays`
 * `staleAfterDays` is PROPOSED configuration (devices.sync_staleness in @tarragon/shared proposed-config): callers pass it in, it is never a literal here.
 */
export function deviceSyncState(input: DeviceSyncInput, nowMs: number, staleAfterDays: number): DeviceSyncState {
  const status = input.status ?? "";
  if (status === "unpaired" || status === "disconnected" || status === "") return "not_set_up";
  if (status === "paused") return "paused";
  if (status === "error" || (input.lastSyncError ?? "").trim().length > 0) return "needs_fix";
  const last = input.lastSyncedAt ? Date.parse(input.lastSyncedAt) : Number.NaN;
  if (Number.isNaN(last)) return "waiting";
  if (nowMs - last > staleAfterDays * 86_400_000) return "stale";
  return "working";
}

/** True for the states that get a Green fix button and say "Needs a quick fix". */
export const needsFix = (state: DeviceSyncState): boolean => state === "needs_fix" || state === "stale";

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
/** "17 Oct", in Africa/Lagos. */
export function shortDateInWords(iso: string | null | undefined): string {
  const at = iso ? Date.parse(iso) : Number.NaN;
  if (Number.isNaN(at)) return "";
  const d = new Date(at + 3_600_000);
  return `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]}`;
}

const DAY_MS = 86_400_000;
const LAGOS_OFFSET_MS = 3_600_000; // Africa/Lagos is UTC+1 all year, no daylight saving.

function lagosParts(ms: number): { day: number; clock: string } {
  const shifted = ms + LAGOS_OFFSET_MS;
  const d = new Date(shifted);
  const minutes = d.getUTCMinutes();
  return { day: Math.floor(shifted / DAY_MS), clock: `${d.getUTCHours()}:${minutes < 10 ? "0" : ""}${minutes}` };
}

type Lookup = (key: keyof typeof uiDeviceOfflineAlertCopy, params?: Record<string, string | number>) => string;

/** "Today at 8:10", "Yesterday at 21:05", "3 days ago", "2 weeks ago". Time of day is Africa/Lagos. */
export function lastSyncedInWords(iso: string | null | undefined, nowMs: number, say: Lookup): string {
  if (!iso) return say("devicesync.last.never");
  const at = Date.parse(iso);
  if (Number.isNaN(at)) return say("devicesync.last.never");
  if (at > nowMs) return say("devicesync.last.just_now"); // a clock set ahead reads as just now, never a future time
  const then = lagosParts(at);
  const now = lagosParts(nowMs);
  const days = Math.max(0, now.day - then.day);
  if (days === 0) return say("devicesync.last.today", { time: then.clock });
  if (days === 1) return say("devicesync.last.yesterday", { time: then.clock });
  if (days < 14) return say("devicesync.last.days", { days });
  if (days < 60) return say("devicesync.last.weeks", { weeks: Math.floor(days / 7) });
  return say("devicesync.last.long");
}

/** The offline note and badge for a log button: nothing when nothing is waiting. */
export function queueNoteView(waiting: number): { show: boolean; badgeKey: "offline.queue_badge"; count: number } {
  const count = Number.isFinite(waiting) && waiting > 0 ? Math.floor(waiting) : 0;
  return { show: count > 0, badgeKey: "offline.queue_badge", count };
}
