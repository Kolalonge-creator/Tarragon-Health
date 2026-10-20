/** Pure helpers for the partner webhook admin screen (S10y). No database, no React. */

export interface HeartbeatRow {
  handler_key?: string;
  pending?: number;
  processing?: number;
  dead?: number;
  is_active: boolean;
  last_success_at: string | null;
  oldest_due_seconds: number;
  lag_incident_open: boolean;
}

export type ProcessorState = "ok" | "never" | "stalled" | "partner_stuck" | "unreadable";

/** A subscriber waiting longer than this with no success since is treated as stalled (matches the lag alert default, 10 minutes). */
export const STALL_SECONDS = 600;

/**
 * Whether the event processor (process-events) is known to be running, judged only from the existing subscriber heartbeat.
 * "never": no active subscriber has ever completed a delivery. "stalled": a lag incident is open, or a subscriber has had work
 * due for STALL_SECONDS or more and has completed nothing in the last STALL_SECONDS. "partner_stuck": the processor works for other
 * subscribers, but every active partner.webhook subscriber has work waiting or dead and has never succeeded (the handler is
 * probably not deployed). A failed read is its own state, never "ok".
 */
export function processorState(rows: readonly HeartbeatRow[], failed: boolean, now: Date = new Date()): ProcessorState {
  if (failed) return "unreadable";
  const active = rows.filter((r) => r.is_active);
  if (active.length === 0 || active.every((r) => !r.last_success_at)) return "never";
  for (const r of active) {
    // a partner subscriber that never succeeded is reported by the more specific partner_stuck check below, not as a stall
    if (r.handler_key === "partner.webhook" && !r.last_success_at) continue;
    if (r.lag_incident_open) return "stalled";
    if (r.oldest_due_seconds >= STALL_SECONDS) {
      const lastOk = r.last_success_at ? new Date(r.last_success_at).getTime() : 0;
      if (now.getTime() - lastOk > STALL_SECONDS * 1000) return "stalled";
    }
  }
  const partner = active.filter((r) => r.handler_key === "partner.webhook");
  if (
    partner.length > 0 &&
    partner.every((r) => !r.last_success_at && Number(r.pending ?? 0) + Number(r.processing ?? 0) + Number(r.dead ?? 0) > 0)
  ) {
    return "partner_stuck";
  }
  return "ok";
}

/** Mirrors the database rule in set_partner_event_mapping: ids only, never a person. */
const PERSON_KEYS = new Set(["patient_id", "profile_id", "user_id", "member_id", "person_id", "clinician_id", "staff_id", "caregiver_id"]);
const ID_KEY = /^[a-z][a-z0-9_]*(_id|_ids)$/;

export function parseIdKeys(raw: string): { keys: string[] } | { error: "invalid" } {
  const keys = [
    ...new Set(
      raw
        .split(",")
        .map((k) => k.trim())
        .filter(Boolean),
    ),
  ];
  if (keys.length > 20) return { error: "invalid" };
  for (const k of keys) {
    if (!ID_KEY.test(k) || PERSON_KEYS.has(k)) return { error: "invalid" };
  }
  return { keys };
}

export type ActionError = "forbidden" | "not_found" | "grace_open" | "reason" | "invalid" | "generic";

/**
 * Maps a database error code to a fixed word. The raw message is never shown (or logged), so nothing unexpected reaches the page.
 * 22023 means a bad reason on re-enable and bad input on a mapping, so the caller says which.
 */
export function errorWord(code: string | undefined, context: "reason" | "mapping" | "other" = "other"): ActionError {
  if (code === "42501") return "forbidden";
  if (code === "55000") return "grace_open";
  if (code === "P0001" || code === "P0002") return "not_found";
  if (code === "22023") return context === "reason" ? "reason" : context === "mapping" ? "invalid" : "generic";
  return "generic";
}
