import { supabase } from "./supabase";
import { recordSyncError } from "./sync-diagnostics";
import { rejectionReasonCode, supportCode, type FailureInfo, type OutboxKind } from "./outbox-rules";

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
): Promise<boolean> {
  try {
    const { data: profile, error: profileError } = await supabase
      .from("profiles")
      .select("organisation_id")
      .eq("id", item.ownerUserId)
      .maybeSingle();
    if (profileError || !profile?.organisation_id) {
      if (profileError) recordSyncError("offline_outbox", "reportRejection:org", profileError.message);
      return false;
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
      return false;
    }
    return true;
  } catch (error) {
    recordSyncError("offline_outbox", "reportRejection", error);
    return false;
  }
}
