import { supabase } from "./supabase";
import { loadMembership } from "./commerce/api";

/**
 * Renewals are discussed at the monthly review, not requested (two-tier decision, 2026-10-13). A Member may leave an optional note for
 * the next review; the doctor sees it only in the audited pre-call summary and nothing is notified. The server (add_review_note)
 * decides who is a Member and enforces the length and rate limits.
 */
export async function loadCanAddReviewNote(): Promise<boolean> {
  const result = await loadMembership();
  if (!result.ok) return false;
  return result.data.isMember || result.data.graceEndsAt !== undefined;
}

export async function addReviewNote(note: string): Promise<{ ok: true } | { ok: false; error: string }> {
  const { error } = await supabase.rpc("add_review_note", { p_medication: null, p_note: note.trim() });
  return error ? { ok: false, error: error.message } : { ok: true };
}
