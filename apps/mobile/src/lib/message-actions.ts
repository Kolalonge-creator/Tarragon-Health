import { supabase } from "./supabase";
import type { SectionId } from "./sections";

/** The same four kinds the database allows (care_message_actions.kind) and the web app shows; each opens a screen in this app. */
export const MESSAGE_ACTIONS: Record<string, { label: string; section: SectionId }> = {
  book_appointment: { label: "Book an appointment", section: "care" },
  upload_result: { label: "Upload a result", section: "labs" },
  log_reading: { label: "Log a reading", section: "vitals" },
  review_medications: { label: "Review your medicines", section: "medications" },
};

/** Action buttons a care-team member attached to these messages, grouped by message id. Unknown kinds are dropped. */
export async function loadMessageActions(messageIds: string[]): Promise<Record<string, string[]>> {
  if (messageIds.length === 0) return {};
  const { data, error } = await supabase.from("care_message_actions").select("message_id, kind").in("message_id", messageIds);
  if (error) throw error;
  const byMessage: Record<string, string[]> = {};
  for (const row of data ?? []) {
    if (!(row.kind in MESSAGE_ACTIONS)) continue;
    (byMessage[row.message_id] ??= []).push(row.kind);
  }
  return byMessage;
}
