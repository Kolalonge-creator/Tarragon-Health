import AsyncStorage from "@react-native-async-storage/async-storage";
import { supabase } from "./supabase";
import { recordSyncError } from "./sync-diagnostics";
import { classifyFailure, rejectionReasonCode, supportCode, type FailureInfo, type OutboxKind } from "./outbox-rules";

export type ReportOutcome = "sent" | "later" | "tomorrow";

const HOLD_KEY = "@tarragon/rejection-hold/v1";
export const REPORT_RETRY_MS = 10 * 60_000;
export const REPORT_GIVE_UP_MS = 24 * 3_600_000;

async function readHolds(): Promise<Record<string, number>> {
  try {
    const raw = await AsyncStorage.getItem(HOLD_KEY);
    const parsed: unknown = raw ? JSON.parse(raw) : {};
    return parsed && typeof parsed === "object" ? (parsed as Record<string, number>) : {};
  } catch {
    return {};
  }
}

/** True while a report for this entry must not be tried again (a failure put it on hold). Never throws. */
export async function reportOnHold(clientId: string, now: number = Date.now()): Promise<boolean> {
  return (await readHolds())[clientId] > now;
}

/** Records the result of an attempt: a refusal waits until tomorrow, any other failure ten minutes, success clears the hold. */
export async function applyReportOutcome(clientId: string, outcome: ReportOutcome, now: number = Date.now()): Promise<void> {
  try {
    const holds = await readHolds();
    for (const [id, until] of Object.entries(holds)) if (until <= now) delete holds[id]; // forget expired holds
    if (outcome === "sent") delete holds[clientId];
    else holds[clientId] = now + (outcome === "tomorrow" ? REPORT_GIVE_UP_MS : REPORT_RETRY_MS);
    await AsyncStorage.setItem(HOLD_KEY, JSON.stringify(holds));
  } catch {
    // a hold that cannot be saved only means one more attempt next flush
  }
}

/**
 * Tells the server (S06x) that it refused an entry the phone logged offline, so support can see it
 * without the patient reading a code down the phone. Sends the kind, a coarse reason class, the HTTP
 * status and the support code the patient already sees. NEVER sends a value, a note, a medicine name
 * or the server's error message (it can echo what the patient typed).
 *
 * Best effort: returns false on any failure and never throws. The table keeps one row per entry, so a
 * repeat report (after Retry, or a lost reply) is ignored by the server.
 */
export async function reportRejection(
  item: { clientId: string; kind: OutboxKind; ownerUserId: string; subjectId: string },
  info: FailureInfo
): Promise<ReportOutcome> {
  try {
    const { data: profile, error: profileError } = await supabase
      .from("profiles")
      .select("organisation_id")
      .eq("id", item.ownerUserId)
      .maybeSingle();
    if (profileError || !profile?.organisation_id) {
      if (profileError) recordSyncError("offline_outbox", "reportRejection:org", profileError.message);
      return "later";
    }
    const { error } = await supabase.from("offline_sync_rejections").insert({
      organisation_id: profile.organisation_id,
      account_id: item.ownerUserId,
      kind: item.kind,
      reason_code: rejectionReasonCode(info),
      http_status: info.status ?? null,
      support_code: supportCode(item.clientId),
      client_id: item.clientId,
    });
    // 23505: already reported, which is success. 53400 (today's cap) is NOT: the row was not stored, so it stays
    // unreported and is tried again at a later flush.
    if (error && error.code !== "23505") {
      recordSyncError("offline_outbox", "reportRejection:insert", error.message);
      // The server REFUSED (the daily cap, a permission): asking again every flush changes nothing. Wait until tomorrow.
      return error.code === "53400" || error.code === "42501" || classifyFailure({ code: error.code, message: error.message }) === "rejected" ? "tomorrow" : "later";
    }
    return "sent";
  } catch (error) {
    recordSyncError("offline_outbox", "reportRejection", error);
    return "later";
  }
}
