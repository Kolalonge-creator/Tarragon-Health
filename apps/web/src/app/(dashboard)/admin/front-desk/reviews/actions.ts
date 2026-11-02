"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { getCurrentProfile } from "@/lib/auth/current-profile";
import { getCallerPermissions } from "@/lib/auth/permissions";
import { createClient } from "@/lib/supabase/server";
import { fdRpcData } from "@/lib/frontdesk/raw-db";

export type ReviewActionState = { error?: string; done?: string } | undefined;

async function requireSuperAdmin(): Promise<string | null> {
  const profile = await getCurrentProfile();
  if (!profile) return "Not signed in";
  // Reviews show what visitors typed, so this is admin only. The database re-checks (private.fd_require_admin).
  const { isSuperAdmin } = await getCallerPermissions();
  return isSuperAdmin ? null : "Only an admin can review conversations";
}

const reviewSchema = z.object({
  reviewId: z.string().uuid(),
  verdict: z.enum(["ok", "wrong", "unsafe"], { message: "Choose fine, wrong or unsafe" }),
  note: z.string().trim().max(1000, "That note is too long").optional(),
});

/** Records the verdict. "Wrong" and "unsafe" need a note. An unsafe verdict opens a safety incident. */
export async function recordReviewAction(_prev: ReviewActionState, formData: FormData): Promise<ReviewActionState> {
  const denied = await requireSuperAdmin();
  if (denied) return { error: denied };
  const parsed = reviewSchema.safeParse({ reviewId: formData.get("reviewId"), verdict: formData.get("verdict"), note: formData.get("note") ?? undefined });
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Invalid request" };
  const note = parsed.data.note ?? "";
  if (parsed.data.verdict !== "ok" && note === "") return { error: `Say what was ${parsed.data.verdict}` };
  const { data, error } = await fdRpcData<string | null>(await createClient(), "fd_review_record", { p_review: parsed.data.reviewId, p_verdict: parsed.data.verdict, p_note: note });
  if (error) return { error: /not waiting/.test(error) ? "That review was already recorded." : error };
  revalidatePath("/admin/front-desk/reviews");
  revalidatePath("/admin/front-desk");
  return { done: data ? "Recorded. A safety incident is now open: close it once you have tightened the rule." : "Recorded." };
}

const closeSchema = z.object({
  incidentId: z.string().uuid(),
  ruleChange: z.string().trim().min(10, "Say which rule or wording you tightened (at least 10 characters)").max(1000, "That is too long"),
});

/** Closes an incident. It can only be closed by saying what was tightened; the change itself is made by a person, in the rules or the approved wording. */
export async function closeIncidentAction(_prev: ReviewActionState, formData: FormData): Promise<ReviewActionState> {
  const denied = await requireSuperAdmin();
  if (denied) return { error: denied };
  const parsed = closeSchema.safeParse({ incidentId: formData.get("incidentId"), ruleChange: formData.get("ruleChange") });
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Invalid request" };
  const { error } = await fdRpcData(await createClient(), "fd_incident_close", { p_incident: parsed.data.incidentId, p_rule_change: parsed.data.ruleChange });
  if (error) return { error: /not open/.test(error) ? "That incident is already closed." : error };
  revalidatePath("/admin/front-desk/reviews");
  revalidatePath("/admin/front-desk");
  return { done: "Incident closed." };
}
