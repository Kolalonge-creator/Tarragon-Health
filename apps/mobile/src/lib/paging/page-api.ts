import * as Crypto from "expo-crypto";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { Platform } from "react-native";
import { supabase } from "@/lib/supabase";

/**
 * The phone's side of the on-call page RPCs (S19e). Every function is an existing S19/S19c database function that checks who
 * is calling and which page is theirs; this file adds no server route and no table. Results are parsed by hand (never trusted
 * as typed) and every call returns an explicit ok/error so no screen can show success for a failed call.
 *
 * Wording rule (INV-07): nothing here ever reads or returns a patient, a reading, a condition or a name. `my_active_pages` only
 * returns the patient id after the clinician has acknowledged, and this file does not select it.
 */
export type Rpc = (fn: string, args?: Record<string, unknown>) => Promise<{ data: unknown; error: { message: string } | null }>;
const realRpc: Rpc = (fn, args) => (supabase as unknown as { rpc: Rpc }).rpc(fn, args);

export type Result<T> = { ok: true; data: T } | { ok: false; error: string };

export interface ActivePage {
  readonly pageId: string;
  readonly rootId: string;
  readonly role: "primary" | "backup" | "escalation";
  readonly level: number;
  readonly sentAt: string;
  readonly acknowledged: boolean;
  readonly secondsWaiting: number;
  readonly delivered: boolean;
  readonly expired: boolean;
}

function rec(v: unknown): Record<string, unknown> | null {
  return typeof v === "object" && v !== null && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
}
const str = (v: unknown): string | null => (typeof v === "string" && v.length > 0 ? v : null);
const num = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);

/** One row of `my_active_pages`, or null when it is not shaped as expected (the row is then dropped and counted by the caller). */
export function parseActivePage(v: unknown): ActivePage | null {
  const r = rec(v);
  if (!r) return null;
  const pageId = str(r.page_id);
  const rootId = str(r.root_id);
  const sentAt = str(r.sent_at);
  const role = r.role;
  const level = num(r.escalation_level);
  const secondsWaiting = num(r.seconds_waiting);
  if (!pageId || !rootId || !sentAt || level === null || secondsWaiting === null) return null;
  if (role !== "primary" && role !== "backup" && role !== "escalation") return null;
  return { pageId, rootId, role, level, sentAt, acknowledged: str(r.acknowledged_at) !== null, secondsWaiting, delivered: str(r.delivered_at) !== null, expired: str(r.expired_at) !== null };
}

export async function loadActivePages(rpc: Rpc = realRpc): Promise<Result<{ pages: ActivePage[]; dropped: number }>> {
  const { data, error } = await rpc("my_active_pages");
  if (error) return { ok: false, error: error.message };
  if (!Array.isArray(data)) return { ok: false, error: "unexpected answer" };
  const pages: ActivePage[] = [];
  let dropped = 0;
  for (const row of data) {
    const p = parseActivePage(row);
    if (p) pages.push(p);
    else dropped += 1;
  }
  // A row we cannot read must not look like "nothing is waiting": say so.
  if (dropped > 0 && pages.length === 0) return { ok: false, error: "could not read the pages" };
  return { ok: true, data: { pages, dropped } };
}

export async function acknowledgePage(pageId: string, rpc: Rpc = realRpc): Promise<Result<null>> {
  const { error } = await rpc("acknowledge_page", { p_page: pageId });
  return error ? { ok: false, error: error.message } : { ok: true, data: null };
}

/** The screen shows a page to its clinician: an `alarm` receipt (idempotent on the server; false means it already had one). */
export async function recordPageShown(pageId: string, deviceId: string | null, rpc: Rpc = realRpc): Promise<Result<boolean>> {
  const { data, error } = await rpc("record_page_delivered", { p_ref: pageId, p_channel: "alarm", p_device: deviceId });
  return error ? { ok: false, error: error.message } : { ok: true, data: data === true };
}

/** A push for this notification is on the phone. The server only records it for a page or test page sent to the signed-in clinician. */
export async function recordNotificationDisplayed(notificationId: string, rpc: Rpc = realRpc): Promise<Result<boolean>> {
  const { data, error } = await rpc("record_notification_displayed", { p_notification: notificationId });
  return error ? { ok: false, error: error.message } : { ok: true, data: data === true };
}

export interface Readiness {
  readonly gaps: readonly string[];
  readonly lastTestPageAcknowledgedAt: string | null;
  readonly pendingTestPageId: string | null;
  readonly testPageDays: number;
  readonly objectiveRequired: boolean;
}

export function parseReadiness(v: unknown): Readiness | null {
  const r = rec(v);
  if (!r || !Array.isArray(r.gaps) || !r.gaps.every((g) => typeof g === "string")) return null;
  const days = num(r.test_page_days);
  if (days === null || days <= 0) return null;
  return {
    gaps: r.gaps as string[],
    lastTestPageAcknowledgedAt: str(r.last_test_page_acknowledged_at),
    pendingTestPageId: str(r.pending_test_page_id),
    testPageDays: days,
    objectiveRequired: r.objective_required === true,
  };
}

export async function loadReadiness(rpc: Rpc = realRpc): Promise<Result<Readiness>> {
  const { data, error } = await rpc("my_on_call_readiness");
  if (error) return { ok: false, error: error.message };
  const r = parseReadiness(data);
  return r ? { ok: true, data: r } : { ok: false, error: "unexpected answer" };
}

export async function sendTestPage(rpc: Rpc = realRpc): Promise<Result<string>> {
  const { data, error } = await rpc("send_test_page", { p_clinician: null, p_kind: "readiness" });
  if (error) return { ok: false, error: error.message };
  return typeof data === "string" ? { ok: true, data } : { ok: false, error: "unexpected answer" };
}

export async function acknowledgeTestPage(testId: string, rpc: Rpc = realRpc): Promise<Result<null>> {
  const { error } = await rpc("acknowledge_test_page", { p_test: testId });
  return error ? { ok: false, error: error.message } : { ok: true, data: null };
}

/** "I am alive" for the health sweep, so a rota with nobody reachable is noticed. Best effort by design: returns whether it landed. */
export async function pingDevice(deviceId: string, rpc: Rpc = realRpc): Promise<boolean> {
  const kind = Platform.OS === "ios" ? "ios" : "android";
  const { error } = await rpc("paging_device_ping", { p_device: deviceId, p_kind: kind });
  lastPingOk = !error;
  return !error;
}

let lastPingOk: boolean | null = null;
/** Whether the latest heartbeat landed (null: none tried yet). The On call screen shows a warning when it is false, because the health sweep treats a silent phone as unreachable. */
export const getLastPingOk = (): boolean | null => lastPingOk;
export const __resetPingForTests = (): void => {
  lastPingOk = null;
};

const DEVICE_KEY = "tarragon.paging.device-id";
let cachedDeviceId: string | null = null;

/** A stable random id for this install (8 to 80 characters, as the database requires). Never derived from the person or the hardware. */
export async function getDeviceId(): Promise<string> {
  if (cachedDeviceId) return cachedDeviceId;
  try {
    const stored = await AsyncStorage.getItem(DEVICE_KEY);
    if (stored && stored.length >= 8 && stored.length <= 80) return (cachedDeviceId = stored);
  } catch {
    // fall through to a fresh id
  }
  const fresh = Crypto.randomUUID();
  try {
    await AsyncStorage.setItem(DEVICE_KEY, fresh);
  } catch {
    // an id that cannot be stored lasts for this app run only
  }
  return (cachedDeviceId = fresh);
}

export const __resetDeviceIdForTests = (): void => {
  cachedDeviceId = null;
};
