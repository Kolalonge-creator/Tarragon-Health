import { parseCareChanges, parseConfirmOutcome, type CareChange, type ConfirmOutcome, type MessageKey } from "@tarragon/i18n";
import { supabase } from "./supabase";

/**
 * The patient's side of a signed care plan change (S24), same three database functions as the web app.
 * Answering needs a connection and is NEVER queued: a medicine change must not be applied from a stale queue,
 * so a failed send is shown as "try again when you are online" and nothing is kept on the phone.
 */

/** A request that never reached the server (no signal, DNS, timeout), as opposed to one the server refused. */
const OFFLINE_PATTERN = /network request failed|failed to fetch|fetch failed|network error|timed? ?out|offline|load failed|internet connection/i;

export function isOfflineError(error: { message?: string | null; status?: number | null } | null | undefined): boolean {
  if (!error) return false;
  if (error.status === 0) return true;
  return OFFLINE_PATTERN.test(error.message ?? "");
}

export type LoadChangesResult = { ok: true; changes: CareChange[] } | { ok: false; offline: boolean };
export type ConfirmResult = { ok: true; outcome: Exclude<ConfirmOutcome, "error"> } | { ok: false; key: MessageKey };
export type DeclineResult = { ok: true; key: MessageKey } | { ok: false; key: MessageKey };

export async function loadCareChanges(): Promise<LoadChangesResult> {
  const { data, error } = await supabase.rpc("my_care_plan_changes");
  if (error) return { ok: false, offline: isOfflineError(error) };
  return { ok: true, changes: parseCareChanges(data) };
}

export async function confirmCareChange(changeId: string): Promise<ConfirmResult> {
  if (!changeId) return { ok: false, key: "careChange.outcome.error" };
  const { data, error } = await supabase.rpc("confirm_care_plan_change", { p_change: changeId });
  if (error) return { ok: false, key: isOfflineError(error) ? "careChange.offline" : "careChange.outcome.error" };
  const outcome = parseConfirmOutcome(data);
  if (outcome === "error") return { ok: false, key: "careChange.outcome.error" };
  return { ok: true, outcome };
}

export async function declineCareChange(changeId: string): Promise<DeclineResult> {
  if (!changeId) return { ok: false, key: "careChange.outcome.error" };
  const { error } = await supabase.rpc("decline_care_plan_change", { p_change: changeId });
  if (error) return { ok: false, key: isOfflineError(error) ? "careChange.offline" : "careChange.outcome.error" };
  return { ok: true, key: "careChange.outcome.declined" };
}

export function formatChangeDate(iso: string): string {
  return new Date(iso).toLocaleDateString("en-GB", { timeZone: "Africa/Lagos", day: "numeric", month: "short", year: "numeric" });
}
