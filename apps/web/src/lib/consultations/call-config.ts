import "server-only";
import { getProposedConfig } from "@tarragon/shared";
import type { CallPolicy } from "./call-controller";

/**
 * S21 follow-up: the server-side switches for the in-app Zoom call. None of these values ever reaches the browser; the page is only
 * told whether the in-app client is available (a boolean), never a key or secret.
 *
 *  - ZOOM_SDK_KEY, ZOOM_SDK_SECRET: the Meeting SDK app's credentials. Without both, the room works exactly as before, by link.
 *    The secret signs the SDK join and also mints the participant keys that prove who entered (OQ-160).
 *  - ZOOM_PRESENCE_WEBHOOK: set to "1" only after the Zoom app's event subscription points at /api/zoom/webhook and has been
 *    validated. Until then a join is recorded when the person is given the way in (the older behaviour). Turning it on with no
 *    working webhook would leave two people in a call that the database thinks nobody entered.
 */
const has = (v: string | undefined): v is string => typeof v === "string" && v.length > 0;

export function participantKeySecret(env: Readonly<Record<string, string | undefined>> = process.env): string | null {
  return has(env["ZOOM_SDK_KEY"]) && has(env["ZOOM_SDK_SECRET"]) ? env["ZOOM_SDK_SECRET"] : null;
}

export function inAppCallAvailable(env: Readonly<Record<string, string | undefined>> = process.env): boolean {
  return participantKeySecret(env) !== null;
}

/** How long a clinician's host key lives (versioned configuration `consultations.host_key`, never hard-coded). */
export function hostKeyTtlSeconds(): number {
  return getProposedConfig<{ ttlSeconds: number }>("consultations.host_key").value.ttlSeconds;
}

export function presenceFromWebhook(env: Readonly<Record<string, string | undefined>> = process.env): boolean {
  return env["ZOOM_PRESENCE_WEBHOOK"] === "1";
}

/**
 * The call policy the page runs the fallback ladder with, or null when the in-app call is not available. The thresholds come from the
 * versioned configuration (`video.audio_fallback`, never hard-coded) and the reconnect window from the consultation's own policy row, so
 * the page and the database agree on how long a dropped connection is held.
 */
export function callPolicyFor(graceSeconds: number, env: Readonly<Record<string, string | undefined>> = process.env): CallPolicy | null {
  if (!inAppCallAvailable(env)) return null;
  const v = getProposedConfig<Omit<CallPolicy, "reconnectGraceSeconds">>("video.audio_fallback").value;
  return { ...v, reconnectGraceSeconds: graceSeconds };
}
