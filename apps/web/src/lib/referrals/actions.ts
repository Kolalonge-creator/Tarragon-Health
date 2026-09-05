"use server";

import { randomUUID } from "crypto";
import { revalidatePath } from "next/cache";
import { createClient, getCurrentUser } from "@/lib/supabase/server";
import { createServiceRoleClient } from "@/lib/supabase/service-role";
import { REFERRAL_OUTCOME_DOC_BUCKET } from "@/lib/referrals/outcome-documents";
import {
  patientReferralOutcomeUploadSchema,
  staffReferralOutcomeUploadSchema,
  validateReferralOutcomeDocFile,
} from "@/lib/validation/specialist-referral-documents";

export type ReferralOutcomeUploadResult = { error?: string; success?: boolean };

const EXT_BY_MIME: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "image/heic": "heic",
  "application/pdf": "pdf",
};

/**
 * A patient uploads the specialist's own letter/report for one of their
 * referrals — the front door the referral letter already promises
 * ("upload it in the app", referral-letter-document.tsx) but that had no
 * implementation anywhere until now.
 *
 * Storage upload runs through the patient's own session (the own-folder
 * policy already allows it). The TABLE write does NOT: confirmed live
 * (via a proof run of packages/db/tests/specialist_referral_engine.sql
 * against the real project, not just reading the migration file) that
 * specialist_referrals' UPDATE policy is staff-only
 * (`private.is_org_staff`) even for a patient's own row — unlike
 * lab_result_documents, this table was hardened at some point to have no
 * patient-write path at all, matching the platform-wide self-update
 * hardening pattern (see profiles_self_update_column_guard and similar).
 * So the row write goes through the service-role client, exactly like
 * uploadResultDocumentForPatient's staff-on-behalf path — except here
 * ownership is verified via the PATIENT's own RLS-scoped session first
 * (a miss means "not yours" — fail rather than silently writing against
 * nothing), and outcome_document_uploaded_by is passed explicitly since
 * auth.uid() resolves to null under the service-role connection (the
 * trigger only auto-derives it when a real session is present — see
 * private.enforce_specialist_referral_outcome_and_closure).
 */
export async function uploadReferralOutcomeDocumentAsPatient(
  formData: FormData,
): Promise<ReferralOutcomeUploadResult> {
  const user = await getCurrentUser();
  if (!user) return { error: "Not signed in" };

  const file = formData.get("file");
  if (!(file instanceof File) || file.size === 0) {
    return { error: "Attach what the specialist gave you (PDF or photo)." };
  }
  const fileError = validateReferralOutcomeDocFile(file);
  if (fileError) return { error: fileError };

  const parsed = patientReferralOutcomeUploadSchema.safeParse({
    referral_id: formData.get("referral_id"),
  });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Invalid input" };
  }

  const supabase = await createClient();

  // RLS already restricts this SELECT to the caller's own referral; a miss
  // here means "not yours" — fail rather than silently filing against nothing.
  const { data: referral } = await supabase
    .from("specialist_referrals")
    .select("id")
    .eq("id", parsed.data.referral_id)
    .eq("patient_id", user.id)
    .maybeSingle();
  if (!referral) return { error: "That referral isn't on your record." };

  const ext = EXT_BY_MIME[file.type] ?? "bin";
  // The leading folder MUST be the caller's uid — exactly what the storage
  // own-folder policy checks.
  const path = `${user.id}/${randomUUID()}.${ext}`;

  const { error: uploadError } = await supabase.storage
    .from(REFERRAL_OUTCOME_DOC_BUCKET)
    .upload(path, file, { contentType: file.type, upsert: false });
  if (uploadError) return { error: uploadError.message };

  const service = createServiceRoleClient();
  const { error: updateError } = await service
    .from("specialist_referrals")
    .update({ outcome_document_path: path, outcome_document_uploaded_by: user.id })
    .eq("id", parsed.data.referral_id);
  if (updateError) {
    // Roll back the orphaned object so a failed write leaves no stray file.
    await supabase.storage.from(REFERRAL_OUTCOME_DOC_BUCKET).remove([path]);
    return { error: updateError.message };
  }

  revalidatePath("/patient");
  return { success: true };
}

/**
 * Org staff uploads a specialist's outcome document on a patient's behalf
 * (e.g. a printed letter the patient brought to a follow-up visit).
 * Storage + row write go through the service-role client: the file lands
 * under the patient's uid folder, which the own-folder storage policy
 * forbids a staff session from writing directly — same shape as
 * uploadResultDocumentForPatient. Attaching a document is not itself a
 * clinical act (no diagnosis/plan is recorded here), so any org-staff role
 * may do this, not just clinical tier — closing the referral afterward is
 * the clinical-tier-gated step.
 */
export async function uploadReferralOutcomeDocumentForPatient(
  formData: FormData,
): Promise<ReferralOutcomeUploadResult> {
  const user = await getCurrentUser();
  if (!user) return { error: "Not signed in" };

  const file = formData.get("file");
  if (!(file instanceof File) || file.size === 0) {
    return { error: "Attach the document (PDF or photo)." };
  }
  const fileError = validateReferralOutcomeDocFile(file);
  if (fileError) return { error: fileError };

  const parsed = staffReferralOutcomeUploadSchema.safeParse({
    referral_id: formData.get("referral_id"),
  });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Invalid input" };
  }

  const supabase = await createClient();
  // RLS (private.is_org_staff) is the real gate — a referral outside the
  // caller's org simply doesn't come back.
  const { data: referral } = await supabase
    .from("specialist_referrals")
    .select("id, patient_id")
    .eq("id", parsed.data.referral_id)
    .maybeSingle();
  if (!referral) return { error: "Referral not found or not in your organisation." };

  const service = createServiceRoleClient();
  const ext = EXT_BY_MIME[file.type] ?? "bin";
  const path = `${referral.patient_id}/${randomUUID()}.${ext}`;

  const { error: uploadError } = await service.storage
    .from(REFERRAL_OUTCOME_DOC_BUCKET)
    .upload(path, file, { contentType: file.type, upsert: false });
  if (uploadError) return { error: uploadError.message };

  // Runs on the caller's own session (not service-role) so
  // outcome_document_uploaded_by is server-derived from THIS staff member's
  // auth.uid(), not lost to the service-role write path.
  const { error: updateError } = await supabase
    .from("specialist_referrals")
    .update({ outcome_document_path: path })
    .eq("id", parsed.data.referral_id);
  if (updateError) {
    await service.storage.from(REFERRAL_OUTCOME_DOC_BUCKET).remove([path]);
    return { error: updateError.message };
  }

  revalidatePath(`/clinician/referrals/${parsed.data.referral_id}`);
  revalidatePath(`/clinician/patients/${referral.patient_id}`);
  return { success: true };
}
