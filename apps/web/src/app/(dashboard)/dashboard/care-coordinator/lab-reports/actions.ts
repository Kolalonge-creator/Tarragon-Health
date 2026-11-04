"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import type { Json } from "@tarragon/shared";
import { createClient, getCurrentUser } from "@/lib/supabase/server";
import { removeFile, storeFile } from "@/lib/lab-results/store-file";
import { DUPLICATE_DOCUMENT_MESSAGE, isDuplicateDocumentError } from "@/lib/clinical-documents/duplicate";
import { describeDocumentRefusal } from "@/lib/clinical-documents/status";

/**
 * Clinical document engine step 2 (decision CDE-03): a Care Coordinator uploads a lab report for a patient, usually one a
 * laboratory emailed to Tarragon. The database functions are the gates: find_patient_for_upload never matches on a name alone,
 * and coordinator_submit_lab_report checks the identity printed on the report against the record before anything is filed. The
 * result is held for a clinician exactly like any care-team upload; the patient sees it only after review (S27 INV-03).
 */

const UPLOADER_ROLES = new Set(["care_coordinator", "lab_liaison"]);

export type UploadPatientMatch = {
  patientId: string;
  patientNumber: string | null;
  fullName: string;
  birthYear: number | null;
  sex: string | null;
  state: string | null;
  phoneLast4: string | null;
};

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Use a full date");

const findSchema = z.object({
  query: z.string().trim().min(3, "Type at least 3 characters.").max(120),
  dateOfBirth: isoDate.optional(),
});

export async function findPatientForUpload(
  input: z.input<typeof findSchema>,
): Promise<{ patients: UploadPatientMatch[] } | { error: string }> {
  const parsed = findSchema.safeParse(input);
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Check the search and try again." };
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("find_patient_for_upload", {
    p_query: parsed.data.query,
    ...(parsed.data.dateOfBirth ? { p_date_of_birth: parsed.data.dateOfBirth } : {}),
  });
  if (error) return { error: describeDocumentRefusal(error, "The search did not work. Try again.") };
  return {
    patients: (data ?? []).map((r) => ({
      patientId: r.patient_id,
      patientNumber: r.patient_number,
      fullName: r.full_name ?? "Unnamed patient",
      birthYear: r.birth_year,
      sex: r.sex,
      state: r.state,
      phoneLast4: r.phone_last4,
    })),
  };
}

const uploadSchema = z
  .object({
    patientId: z.string().uuid(),
    nameOnReport: z.string().trim().min(3, "Enter the name printed on the report.").max(200),
    dateOfBirthOnReport: isoDate.optional(),
    patientNumberOnReport: z.string().trim().max(40).optional(),
    labProviderId: z.string().uuid().optional(),
    labName: z.string().trim().max(200).optional(),
    investigationDate: isoDate.optional(),
    note: z.string().trim().max(1000).optional(),
  })
  .refine((v) => v.dateOfBirthOnReport || v.patientNumberOnReport, {
    message: "Enter the date of birth or the patient number printed on the report, as well as the name.",
  })
  .refine((v) => v.labProviderId || v.labName, { message: "Say which laboratory or centre the report came from." });

export type UploadState = { error?: string; success?: boolean } | undefined;

const optional = (v: FormDataEntryValue | null) => (typeof v === "string" && v.trim() !== "" ? v : undefined);

export async function uploadLabReportForPatient(_prev: UploadState, formData: FormData): Promise<UploadState> {
  const user = await getCurrentUser();
  if (!user) return { error: "You are signed out. Sign in again to continue." };

  const parsed = uploadSchema.safeParse({
    patientId: formData.get("patientId"),
    nameOnReport: formData.get("nameOnReport"),
    dateOfBirthOnReport: optional(formData.get("dateOfBirthOnReport")),
    patientNumberOnReport: optional(formData.get("patientNumberOnReport")),
    labProviderId: optional(formData.get("labProviderId")),
    labName: optional(formData.get("labName")),
    investigationDate: optional(formData.get("investigationDate")),
    note: optional(formData.get("note")),
  });
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Check the form and try again." };
  const v = parsed.data;

  const file = formData.get("file");
  if (!(file instanceof File) || file.size === 0) return { error: "Attach the report (PDF or photo)." };

  // The file is stored with the service role before the database function runs, so check first that this account may upload for
  // this patient at all: a coordinator, and the patient in the same organisation. The database repeats both checks.
  const supabase = await createClient();
  const { data: me } = await supabase.from("profiles").select("role, organisation_id").eq("id", user.id).single();
  if (!me || !UPLOADER_ROLES.has(me.role) || !me.organisation_id) return { error: "You do not have access to that." };
  const { data: patient } = await supabase
    .from("profiles")
    .select("id, organisation_id, role")
    .eq("id", v.patientId)
    .maybeSingle();
  if (!patient || patient.role !== "patient" || patient.organisation_id !== me.organisation_id) {
    return { error: "That patient isn't in your organisation." };
  }

  const stored = await storeFile(v.patientId, file);
  if ("error" in stored) return { error: stored.error };

  const { error } = await supabase.rpc("coordinator_submit_lab_report", {
    p_patient: v.patientId,
    p_file: stored as unknown as Json,
    p_identity: {
      name_on_report: v.nameOnReport,
      date_of_birth_on_report: v.dateOfBirthOnReport ?? null,
      patient_number_on_report: v.patientNumberOnReport ?? null,
    } as unknown as Json,
    ...(v.labProviderId ? { p_source_facility_id: v.labProviderId } : {}),
    ...(v.labName ? { p_source_facility_name: v.labName } : {}),
    ...(v.investigationDate ? { p_investigation_date: v.investigationDate } : {}),
    ...(v.note ? { p_admin_note: v.note } : {}),
  });
  if (error) {
    await removeFile(stored.file_path);
    if (isDuplicateDocumentError(error)) return { error: DUPLICATE_DOCUMENT_MESSAGE };
    return { error: describeDocumentRefusal(error, "The report could not be uploaded. Try again.") };
  }
  revalidatePath("/dashboard/care-coordinator/lab-reports");
  return { success: true };
}

const correctSchema = z.object({
  documentId: z.string().uuid(),
  reason: z.string().trim().min(5, "Give a short reason for the change.").max(500),
  investigationDate: isoDate.optional(),
  labProviderId: z.string().uuid().optional(),
  labName: z.string().trim().max(200).optional(),
  note: z.string().trim().max(1000).optional(),
});

export async function correctUploadDetails(input: z.input<typeof correctSchema>): Promise<UploadState> {
  const parsed = correctSchema.safeParse(input);
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Check the form and try again." };
  const v = parsed.data;
  const supabase = await createClient();
  const { error } = await supabase.rpc("correct_clinical_document_metadata", {
    p_document: v.documentId,
    p_reason: v.reason,
    ...(v.investigationDate ? { p_investigation_date: v.investigationDate } : {}),
    ...(v.labProviderId ? { p_source_facility_id: v.labProviderId } : {}),
    ...(v.labName ? { p_source_facility_name: v.labName } : {}),
    ...(v.note ? { p_admin_note: v.note } : {}),
  });
  if (error) return { error: describeDocumentRefusal(error, "The change could not be saved. Try again.") };
  revalidatePath("/dashboard/care-coordinator/lab-reports");
  return { success: true };
}
