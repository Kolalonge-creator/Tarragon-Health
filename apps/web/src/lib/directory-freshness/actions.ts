"use server";

import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { loose } from "@/lib/clinician/loose-client";
import { recheckFormSchema, recordFormSchema, type Notice } from "./model";

const back = (n: Notice): never => redirect(`/admin/ops/directory-freshness?n=${n}`);

/**
 * Records that a person checked a listing. The database decides who may (the manage permission for that kind of listing),
 * demands the note, sets the next due date from the configured cadence and writes the audit row; this only passes the form on
 * and turns the answer into a fixed notice. It never edits the listing itself.
 */
export async function recordDirectoryVerificationAction(formData: FormData): Promise<void> {
  const parsed = recordFormSchema.safeParse({
    listing_table: formData.get("listing_table"),
    listing_id: formData.get("listing_id"),
    note: formData.get("note"),
  });
  if (!parsed.success) {
    const note = String(formData.get("note") ?? "").trim();
    return back(note.length < 10 ? "note_short" : "record_failed");
  }
  const { error } = await loose(await createClient()).rpc("record_directory_verification", {
    p_listing_table: parsed.data.listing_table,
    p_listing_id: parsed.data.listing_id,
    p_note: parsed.data.note,
  });
  if (error) return back(error.code === "42501" ? "record_denied" : error.code === "22023" ? "note_short" : "record_failed");
  return back("recorded");
}

/**
 * Marks a verified listing as needing a new check (S-19: a complaint or incident is a reason to look again, not to switch the
 * listing off). The database sets it overdue and audits the reason; nothing is hidden or deactivated.
 */
export async function requestDirectoryRecheckAction(formData: FormData): Promise<void> {
  const parsed = recheckFormSchema.safeParse({
    listing_table: formData.get("listing_table"),
    listing_id: formData.get("listing_id"),
    reason: formData.get("reason"),
  });
  if (!parsed.success) return back("note_short");
  const { error } = await loose(await createClient()).rpc("request_directory_recheck", {
    p_listing_table: parsed.data.listing_table,
    p_listing_id: parsed.data.listing_id,
    p_reason: parsed.data.reason,
  });
  if (error) return back(error.code === "42501" ? "record_denied" : error.code === "22023" ? "note_short" : "record_failed");
  return back("recheck_requested");
}
