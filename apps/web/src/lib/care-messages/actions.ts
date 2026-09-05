"use server";

import { createClient } from "@/lib/supabase/server";
import { createServiceRoleClient } from "@/lib/supabase/service-role";
import { generateDraftReply } from "./generate-draft-reply";

/**
 * Mirrors private.is_org_staff's role set for this specific purpose --
 * clinician, care_coordinator, and the org admin super-user
 * (packages/db's 20260729234618_harden_is_org_staff_exclude_lab_partner.sql
 * is the source of truth). This is a defense-in-depth UI gate only: the real
 * write boundary is that care_message_draft_replies carries no insert/
 * update/delete policy at all, so even a caller that got past this check
 * could not write the row itself -- only the service-role generator below
 * can. The point of gating here is to keep an unrelated account (a patient,
 * or a partner/back-office role) from triggering a paid Claude call for a
 * draft they could never read.
 */
const STAFF_ROLES = ["clinician", "care_coordinator", "admin"] as const;

/**
 * Generates (or regenerates) the AI-drafted reply suggestion for a
 * care_messages thread. Manual only -- called from the "Draft reply"
 * control in the thread view, never automatically on an inbound patient
 * message (case_briefs' auto-on-acknowledge trigger doesn't apply here on
 * purpose: it would mean a Claude call for every patient message regardless
 * of whether a staff member is about to reply).
 */
export async function generateDraftReplyAction(threadId: string): Promise<{ success: boolean }> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { success: false };

  const { data: profile } = await supabase
    .from("profiles")
    .select("role")
    .eq("id", user.id)
    .maybeSingle();
  if (!profile || !STAFF_ROLES.includes(profile.role as (typeof STAFF_ROLES)[number])) {
    return { success: false };
  }

  // RLS on care_message_threads is the real gate on which thread this caller
  // may touch -- a staff account outside the thread's org simply gets no row
  // back.
  const { data: thread } = await supabase
    .from("care_message_threads")
    .select("organisation_id, patient_id")
    .eq("id", threadId)
    .maybeSingle();
  if (!thread) return { success: false };

  const result = await generateDraftReply(supabase, createServiceRoleClient, {
    threadId,
    organisationId: thread.organisation_id,
    patientId: thread.patient_id,
  });
  return { success: result.status === "generated" };
}
