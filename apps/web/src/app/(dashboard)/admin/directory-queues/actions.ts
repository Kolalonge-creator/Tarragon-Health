"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { getCurrentProfile } from "@/lib/auth/current-profile";
import { createClient } from "@/lib/supabase/server";

export type QueueActionState = { error?: string; done?: string } | undefined;

const PATH = "/admin/directory-queues";

const moderateSchema = z.object({
  rating: z.string().uuid(),
  decision: z.enum(["publish", "publish_without_comment", "reject"]),
  reason: z.string().trim().max(500).optional(),
});

/**
 * Publish, publish without the comment, or reject one pending facility rating (S65, 15.11). Who may do this is decided in the database by
 * moderate_facility_rating (private.directory_can_record('facilities')); this action only passes the choice through and reports a refusal.
 * A held comment (one that may judge a clinician) cannot be published whole: the database refuses it and the message says why.
 */
export async function moderateRatingAction(_prev: QueueActionState, formData: FormData): Promise<QueueActionState> {
  if (!(await getCurrentProfile())) return { error: "Please sign in again." };
  const parsed = moderateSchema.safeParse({
    rating: formData.get("rating"),
    decision: formData.get("decision"),
    reason: (formData.get("reason") as string | null) || undefined,
  });
  if (!parsed.success) return { error: "That request was not valid." };
  if (parsed.data.decision === "reject" && !parsed.data.reason) return { error: "Please give a reason for rejecting a rating." };

  const supabase = await createClient();
  const { error } = await supabase.rpc("moderate_facility_rating", {
    p_rating: parsed.data.rating,
    p_decision: parsed.data.decision,
    p_reason: parsed.data.reason,
  });
  if (error) return { error: error.message };
  revalidatePath(PATH);
  return { done: parsed.data.decision === "reject" ? "Rating rejected." : "Rating published." };
}

const checkSchema = z.object({
  // The re-verification queue only ever holds these two (directory_reverification_queue.listing_table check).
  table: z.enum(["facilities", "specialist_providers"]),
  listing: z.string().uuid(),
  tier: z.enum(["phone_confirmed", "licence_checked"]),
  note: z.string().trim().min(3).max(500),
});

/**
 * Record that a listing named in the re-verification queue was checked. record_directory_check writes the dated verification (which is what
 * closes the queue entry and resets the "last verified" date patients see) and sets the tier. A report never edits a listing by itself;
 * a person checks it and says so here.
 */
export async function recordCheckAction(_prev: QueueActionState, formData: FormData): Promise<QueueActionState> {
  if (!(await getCurrentProfile())) return { error: "Please sign in again." };
  const parsed = checkSchema.safeParse({
    table: formData.get("table"),
    listing: formData.get("listing"),
    tier: formData.get("tier"),
    note: formData.get("note"),
  });
  if (!parsed.success) return { error: "Please say how you checked it, in a few words." };

  const supabase = await createClient();
  const { error } = await supabase.rpc("record_directory_check", {
    p_listing_table: parsed.data.table,
    p_listing_id: parsed.data.listing,
    p_note: parsed.data.note,
    p_tier: parsed.data.tier,
  });
  if (error) return { error: error.message };
  revalidatePath(PATH);
  return { done: "Check recorded." };
}
