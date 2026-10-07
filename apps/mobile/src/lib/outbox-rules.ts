/**
 * Pure rules for the offline outbox (S06). No I/O, so every branch is unit
 * tested. Numbers that are PROPOSED values live in OfflineSyncConfig, which
 * the server versions (public.offline_sync_config); DEFAULT_OFFLINE_SYNC_CONFIG
 * is only the bundled fallback for a phone that has never synced.
 */

export type OutboxKind = "vital" | "symptom" | "dose" | "kick_session" | "contraction_session";
export type OutboxState = "pending" | "rejected";

export interface OfflineSyncConfig {
  version: number;
  backdateWindowHours: number;
  stuckNoticeHours: number;
  stuckNoticeDangerHours: number;
  pullOverlapMinutes: number;
}

export const DEFAULT_OFFLINE_SYNC_CONFIG: OfflineSyncConfig = {
  version: 1,
  backdateWindowHours: 72,
  stuckNoticeHours: 12,
  stuckNoticeDangerHours: 1,
  pullOverlapMinutes: 10,
};

export type FailureClass = "network" | "auth" | "retry" | "rejected" | "duplicate";

export interface FailureInfo {
  /** HTTP status when the failure came from the API, or from PostgREST. */
  status?: number;
  /** Postgres or PostgREST error code, e.g. 23505, 42501. */
  code?: string;
  message?: string;
}

const NETWORK_PATTERN = /network request failed|failed to fetch|couldn't reach the server|timeout|timed out|aborted/i;
const AUTH_PATTERN = /jwt expired|not signed in|session expired|invalid or expired session/i;

/**
 * Decides what a failed send means. The order matters: a duplicate is success
 * in disguise, a network or auth failure says nothing about the row itself and
 * must not use up an attempt, a 4xx or constraint error will never succeed.
 */
export function classifyFailure(info: FailureInfo): FailureClass {
  const { status, code, message = "" } = info;
  if (code === "23505") return "duplicate";
  if (status === 401 || code === "PGRST301" || AUTH_PATTERN.test(message)) return "auth";
  if (!code && (status === undefined || status === 0) && NETWORK_PATTERN.test(message)) return "network";
  if (code === "42501" || (code && /^(22|23)/.test(code))) return "rejected";
  if (status !== undefined && status >= 400 && status < 500 && status !== 408 && status !== 429) return "rejected";
  return "retry";
}

const BACKOFF_BASE_MS = 30_000;
const BACKOFF_CAP_MS = 30 * 60_000;

/** 30 s, 60 s, 2 min ... capped at 30 min. attempts is the count already made. */
export function backoffMs(attempts: number): number {
  if (attempts <= 0) return 0;
  return Math.min(BACKOFF_CAP_MS, BACKOFF_BASE_MS * 2 ** (attempts - 1));
}

export interface TimedRow {
  created_at: string;
  danger: number;
  state: OutboxState;
}

/** True once an unsynced row has waited longer than the configured notice time. */
export function isStuck(row: TimedRow, now: Date, config: OfflineSyncConfig): boolean {
  if (row.state === "rejected") return true;
  const hours = row.danger ? config.stuckNoticeDangerHours : config.stuckNoticeHours;
  return now.getTime() - new Date(row.created_at).getTime() >= hours * 3_600_000;
}

/** Short code a patient can read to support. First 8 characters of the id. */
export function supportCode(clientId: string): string {
  return clientId.replace(/-/g, "").slice(0, 8).toUpperCase();
}

/**
 * Whether a flush may send this row under the current session. A row logged
 * under one account is never flushed under another (S06 design note, rule
 * "who logged it").
 */
export function mayFlushUnder(rowOwner: string, sessionUserId: string | null): boolean {
  return sessionUserId !== null && rowOwner === sessionUserId;
}

/** Keyset cursor for a pull: re-read an overlap window behind the stored cursor. */
export function pullFloor(cursorIso: string | null, config: OfflineSyncConfig): string | null {
  if (!cursorIso) return null;
  return new Date(new Date(cursorIso).getTime() - config.pullOverlapMinutes * 60_000).toISOString();
}

/** The device clock is only a claim. Mirrors private.resolve_offline_event_time for display. */
export function effectiveTimeForDisplay(
  clientIso: string,
  receivedIso: string,
  config: OfflineSyncConfig,
  skewMinutes = 5
): { iso: string; basis: "client_bounded" | "server" } {
  const client = new Date(clientIso).getTime();
  const received = new Date(receivedIso).getTime();
  if (client <= received + skewMinutes * 60_000 && client >= received - config.backdateWindowHours * 3_600_000) {
    return { iso: new Date(Math.min(client, received)).toISOString(), basis: "client_bounded" };
  }
  return { iso: receivedIso, basis: "server" };
}
