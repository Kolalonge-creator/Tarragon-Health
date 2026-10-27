/**
 * The one-tap "ask my Care Circle for help" alert on the phone (S65, spec 15.15). Same database functions as the web card.
 *
 * Location: the phone sends NONE. Reading the phone's position needs expo-location, a native module this app does not ship, and adding one
 * means a new store build (the OTA runtime version would have to move). So every alert from the phone says "your location was not shared"
 * (the database reports location_shared = false because no coordinates arrive), which is true. A person who turned location sharing on
 * from the web can still turn it OFF here: withdrawing consent must be possible anywhere and takes effect straight away in the database.
 *
 * The tap never depends on a send succeeding for the person to get help: the card always shows the "call someone you trust or go to the
 * nearest hospital" fallback when the alert fails.
 */
import { supabase } from "../supabase";

export interface HelpAlertResult {
  alreadySent: boolean;
  recipientsTold: number;
  locationShared: boolean;
}

export type HelpAlertOutcome = { ok: true; result: HelpAlertResult } | { ok: false; notOpen: boolean; tooMany: boolean };

function num(v: unknown): number {
  return typeof v === "number" && Number.isFinite(v) ? v : 0;
}

/** Defensive parse of the function's json: anything unexpected reads as "nobody was told", never as a success that did not happen. */
export function parseHelpAlert(data: unknown): HelpAlertResult | null {
  if (typeof data !== "object" || data === null) return null;
  const d = data as Record<string, unknown>;
  if (typeof d.already_sent !== "boolean") return null;
  return { alreadySent: d.already_sent, recipientsTold: num(d.recipients_told), locationShared: d.location_shared === true };
}

export async function sendHelpAlert(): Promise<HelpAlertOutcome> {
  const { data, error } = await supabase.rpc("send_circle_help_alert", {});
  if (error) return { ok: false, notOpen: error.code === "55000", tooMany: error.code === "54000" };
  const result = parseHelpAlert(data);
  return result ? { ok: true, result } : { ok: false, notOpen: false, tooMany: false };
}

/** The person's own consent row (row security shows nobody else's). A missing row, or a failed read, is "not on". */
export async function loadLocationConsent(): Promise<boolean> {
  const { data, error } = await supabase.from("care_circle_location_consents" as never).select("granted").maybeSingle();
  if (error) return false;
  return Boolean((data as { granted?: boolean } | null)?.granted);
}

/** Only ever called with false on the phone (turn off). Turning it on would promise a location this app cannot attach. */
export async function revokeLocationConsent(): Promise<boolean> {
  const { error } = await supabase.rpc("set_circle_location_consent", { p_granted: false });
  return error === null;
}
