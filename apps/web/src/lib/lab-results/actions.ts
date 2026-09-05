"use server";

import { randomUUID } from "crypto";
import { revalidatePath } from "next/cache";
import type { Database } from "@tarragon/shared";
import { createClient, getCurrentUser } from "@/lib/supabase/server";
import { createServiceRoleClient } from "@/lib/supabase/service-role";
import { RESULT_DOC_BUCKET } from "@/lib/lab-results/documents";
import { runLabReportExtraction } from "@/lib/lab-reports/extraction-actions";
import {
  labPartnerResultUploadSchema,
  markResultReviewedSchema,
  patientResultUploadSchema,
  staffResultUploadSchema,
  validateResultDocFile,
} from "@/lib/validation/lab-result-documents";

type DocumentSource = Database["public"]["Enums"]["lab_result_document_source"];
export type ResultUploadResult = {
  error?: string;
  success?: boolean;
  /**
   * Set when `error` is specifically "no paid consultation-fee credit" —
   * lets the UI offer a "pay and continue" action instead of a dead-end
   * error, rather than lumping it in with every other upload failure.
   */
  requiresConsultFeePayment?: boolean;
};

/** The stable, machine-readable marker
 * public.claim_lab_result_consult_credit raises in its error DETAIL when no
 * unclaimed, paid request is found — never pattern-match on its message
 * text, which is free to change. */
const CONSULT_FEE_REQUIRED_DETAIL = "CONSULT_FEE_REQUIRED";

/**
 * Which staff account roles may upload a result on a patient's behalf, and the
 * document `source` each is recorded as. Derived from the caller's real role —
 * never trusted from the client. Care Coordinators are deliberately absent: the
 * non-clinical write guardrail (CLAUDE.md) keeps them read-only here, enforced
 * at this app layer exactly like medications/protocol signing.
 */
const UPLOADER_SOURCE: Partial<Record<string, DocumentSource>> = {
  lab_liaison: "lab_liaison",
  clinician: "clinician",
  doctor: "clinician",
  admin: "admin",
};

const EXT_BY_MIME: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "image/heic": "heic",
  "application/pdf": "pdf",
};

/**
 * A staff member (Lab Liaison Officer, clinician/doctor, or admin) uploads a
 * lab result document into a patient's record — the emailed-result path for
 * labs that never log into Tarragon.
 *
 * Storage + row writes go through the service-role client: the file lands under
 * the *patient's* uid folder, which the own-folder storage policy forbids a
 * staff session from writing directly. Authorisation is checked here first
 * (role gate + the patient must be readable in the caller's org via their own
 * RLS-scoped session); uploaded_by is pinned to the acting staff id, and the
 * insert trigger raises the clinician-review alert + notifies the patient.
 */
export async function uploadResultDocumentForPatient(
  formData: FormData,
): Promise<ResultUploadResult> {
  const user = await getCurrentUser();
  if (!user) return { error: "Not signed in" };

  const supabase = await createClient();
  const { data: me } = await supabase
    .from("profiles")
    .select("role, organisation_id")
    .eq("id", user.id)
    .single();

  const source = me ? UPLOADER_SOURCE[me.role] : undefined;
  if (!source) {
    return {
      error:
        "Your role can't upload results for a patient. Ask a Lab Liaison Officer, clinician, or admin.",
    };
  }

  const file = formData.get("file");
  if (!(file instanceof File) || file.size === 0) {
    return { error: "Attach the result file (PDF or image)." };
  }
  const fileError = validateResultDocFile(file);
  if (fileError) return { error: fileError };

  const parsed = staffResultUploadSchema.safeParse({
    patient_id: formData.get("patient_id"),
    lab_order_id: formData.get("lab_order_id") || undefined,
    note: formData.get("note") || undefined,
  });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Invalid input" };
  }
  const { patient_id: patientId, lab_order_id: labOrderId, note } = parsed.data;

  // The patient must be visible to the caller under their own RLS-scoped session
  // — i.e. genuinely a patient in the caller's organisation. This is the real
  // cross-tenant gate (same as any org-staff patient lookup in this app).
  const { data: patient } = await supabase
    .from("profiles")
    .select("id, organisation_id")
    .eq("id", patientId)
    .eq("role", "patient")
    .maybeSingle();
  // ...and the org is compared explicitly rather than left implicit in that
  // read. profiles carries several permissive SELECT policies that OR
  // together, so "the caller could read this row" has never been the same
  // statement as "this patient is in the caller's organisation" — and
  // everything below this line runs on the service-role client, which has no
  // RLS of its own to fall back on. Defence in depth for the 20260905000206
  // care_access_requests disclosure, which reached exactly this seam.
  if (!patient || !patient.organisation_id || patient.organisation_id !== me?.organisation_id) {
    return { error: "That patient isn't in your organisation." };
  }

  const service = createServiceRoleClient();
  const ext = EXT_BY_MIME[file.type] ?? "bin";
  const path = `${patientId}/${randomUUID()}.${ext}`;

  const { error: uploadError } = await service.storage
    .from(RESULT_DOC_BUCKET)
    .upload(path, file, { contentType: file.type, upsert: false });
  if (uploadError) return { error: uploadError.message };

  // Routed through an RPC (rather than a raw .insert()) so the write can be attributed to the
  // uploading staff member in public.audit_log despite running on the service-role client — see
  // 20260812041044_service_role_write_actor_attribution.sql.
  const { data: insertedId, error: insertError } = await service.rpc(
    "insert_audited_lab_result_document",
    {
      p_organisation_id: patient.organisation_id,
      p_patient_id: patientId,
      p_lab_order_id: (labOrderId ?? null) as unknown as string,
      p_file_path: path,
      p_original_filename: file.name,
      p_mime_type: file.type,
      p_file_size_bytes: file.size,
      p_source: source,
      p_uploaded_by: user.id,
      p_note: (note ?? null) as unknown as string,
      p_actor_id: user.id,
    }
  );
  const inserted = insertedId ? { id: insertedId } : null;
  if (insertError || !inserted) {
    // Roll back the orphaned object so a failed insert leaves no stray file.
    await service.storage.from(RESULT_DOC_BUCKET).remove([path]);
    return { error: insertError?.message ?? "Could not save that upload." };
  }

  // Same structured read as the patient-upload path — an emailed result is no
  // less worth turning into trendable numbers. Never throws.
  await runLabReportExtraction(service, {
    documentId: inserted.id,
    organisationId: patient.organisation_id,
    patientId,
    filePath: path,
    mimeType: file.type,
  });

  revalidatePath("/lab-liaison");
  revalidatePath(`/clinician/patients/${patientId}`);
  return { success: true };
}

/**
 * A patient uploads their own result, from whichever lab they used. This is the
 * front door of the self-arranged model: Tarragon issues the request, the
 * patient goes wherever suits them, and this is how the result gets back.
 *
 * Deliberately runs through the patient's OWN session rather than the
 * service-role client the staff path needs. Both halves of the permission were
 * already in place and simply had no UI:
 *   - storage: the 'lab result doc patient insert' policy allows writing into
 *     the caller's own {auth.uid()}/ folder;
 *   - row: lab_result_documents_insert allows patient_id = auth.uid() when
 *     source = 'patient'.
 * So there is nothing to elevate, and nothing here can write into another
 * patient's record even if this action were called with a forged body.
 *
 * source is pinned to 'patient' and patient_id comes from the session, never
 * from the form. private.handle_lab_result_document then raises the
 * clinician_review alert, forces reviewed_by/at null, and deliberately skips
 * the "your result is available" notification for a self-upload. Uploading a
 * file never records a clinical finding on its own — a clinician does that.
 *
 * Founder rule, 2026-08-30: uploading is now gated behind a one-off ₦10,000
 * consultation fee (see requestLabResultConsult in the patient dashboard's
 * lab-result-consult-actions.ts, and the lab_result_consult_requests /
 * public.claim_lab_result_consult_credit migrations). The gate is DB-enforced
 * — public.claim_lab_result_consult_credit is called BEFORE the storage
 * upload even starts (so an unpaid patient never wastes an upload), and it
 * atomically finds-and-reserves a paid, unclaimed request or raises; a
 * network-billed (fulfilment='partner') order is exempt and skips this
 * entirely (claim returns null, nothing to do). This does NOT change what
 * gates a doctor actually READING the upload — that stays
 * private.patient_has_feature_access("result_document_review")'s call
 * (subscription-plan gated), an unrelated, orthogonal rule: this fee gates
 * whether the upload is allowed to happen at all, not whether it gets read.
 */
export async function uploadResultDocumentAsPatient(
  formData: FormData,
): Promise<ResultUploadResult> {
  const user = await getCurrentUser();
  if (!user) return { error: "Not signed in" };

  const file = formData.get("file");
  if (!(file instanceof File) || file.size === 0) {
    return { error: "Attach the result file (PDF or photo)." };
  }
  const fileError = validateResultDocFile(file);
  if (fileError) return { error: fileError };

  const parsed = patientResultUploadSchema.safeParse({
    lab_order_id: formData.get("lab_order_id") || undefined,
    note: formData.get("note") || undefined,
  });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Invalid input" };
  }
  const { lab_order_id: labOrderId, note } = parsed.data;

  const supabase = await createClient();

  // organisation_id is derived from the caller's own profile, never sent by the
  // client — it is what every downstream RLS policy and the alert trigger key
  // off, so it must not be forgeable.
  const { data: me } = await supabase
    .from("profiles")
    .select("organisation_id")
    .eq("id", user.id)
    .single();
  if (!me?.organisation_id) {
    return { error: "Your account isn't set up for uploads yet. Message your care team." };
  }

  // If an order is named, confirm it is genuinely theirs. RLS would already
  // reject a foreign order on read, so a miss here means "not yours" — fail
  // rather than silently filing the result against nothing.
  if (labOrderId) {
    const { data: order } = await supabase
      .from("lab_orders")
      .select("id")
      .eq("id", labOrderId)
      .eq("patient_id", user.id)
      .maybeSingle();
    if (!order) return { error: "That test request isn't on your record." };
  }

  // The consultation-fee gate — called BEFORE the storage upload so an
  // unpaid patient never wastes one. Returns the claimed request id (settle
  // it once the document exists, below), or null when the linked order is
  // network-billed and the fee doesn't apply, or raises when there is no
  // paid credit to claim.
  let claimedRequestId: string | null = null;
  const { data: claimed, error: claimError } = await supabase.rpc(
    "claim_lab_result_consult_credit",
    { p_patient_id: user.id, p_lab_order_id: (labOrderId ?? null) as unknown as string },
  );
  if (claimError) {
    if (claimError.details === CONSULT_FEE_REQUIRED_DETAIL) {
      return {
        error:
          "Pay the ₦10,000 lab-result consultation fee to upload this result — it also books you a 15-minute call with a doctor to walk through it.",
        requiresConsultFeePayment: true,
      };
    }
    return { error: claimError.message };
  }
  claimedRequestId = claimed ?? null;

  const ext = EXT_BY_MIME[file.type] ?? "bin";
  // The leading folder MUST be the caller's uid: that is exactly what the
  // storage own-folder policy checks.
  const path = `${user.id}/${randomUUID()}.${ext}`;

  const { error: uploadError } = await supabase.storage
    .from(RESULT_DOC_BUCKET)
    .upload(path, file, { contentType: file.type, upsert: false });
  if (uploadError) {
    // A claimed credit must not be stranded by a storage failure — release
    // it back to payment_confirmed so the patient can retry without paying
    // again.
    if (claimedRequestId) {
      await supabase.rpc("settle_lab_result_consult_claim", {
        p_request_id: claimedRequestId,
        p_document_id: null as unknown as string,
      });
    }
    return { error: uploadError.message };
  }

  const { data: inserted, error: insertError } = await supabase
    .from("lab_result_documents")
    .insert({
      organisation_id: me.organisation_id,
      patient_id: user.id,
      lab_order_id: labOrderId ?? null,
      file_path: path,
      original_filename: file.name,
      mime_type: file.type,
      file_size_bytes: file.size,
      source: "patient",
      uploaded_by: user.id,
      note: note ?? null,
    })
    .select("id")
    .single();
  if (insertError || !inserted) {
    // Roll back the orphaned object so a failed insert leaves no stray file,
    // and release the claimed credit (see above) for the same reason.
    await supabase.storage.from(RESULT_DOC_BUCKET).remove([path]);
    if (claimedRequestId) {
      await supabase.rpc("settle_lab_result_consult_claim", {
        p_request_id: claimedRequestId,
        p_document_id: null as unknown as string,
      });
    }
    return { error: insertError?.message ?? "Could not save that upload." };
  }

  // Link the claimed credit to the document that just landed — best-effort;
  // the credit is already consumed (claim flipped its status), this only
  // affects traceability, never whether the upload itself succeeded.
  if (claimedRequestId) {
    await supabase.rpc("settle_lab_result_consult_claim", {
      p_request_id: claimedRequestId,
      p_document_id: inserted.id,
    });
  }

  // Read the document into structured values so the clinician opening the alert
  // already has numbers to check rather than a PDF to squint at. Awaited (it
  // never throws, and a failure just persists a 'failed' row) so the clinician
  // is not racing the model; the patient's own confirmation does not depend on
  // the outcome either way.
  await runLabReportExtraction(createServiceRoleClient(), {
    documentId: inserted.id,
    organisationId: me.organisation_id,
    patientId: user.id,
    filePath: path,
    mimeType: file.type,
  });

  revalidatePath("/patient");
  revalidatePath("/patient/prevention");
  return { success: true };
}

/**
 * A clinician marks an uploaded document reviewed AND sends the patient a
 * plain-language interpretation of it, with next steps if the result needs
 * them to do something. Runs through the clinician's own RLS-scoped session
 * so the update-guard trigger stamps reviewed_by = their auth.uid() (never
 * spoofable). Gated on an active clinical_staff record — a Care Coordinator
 * (org staff, non-clinical) cannot review, matching the
 * vaccination-verification pattern. Interpreting a result is a clinical
 * judgement; recording an abnormal finding is a separate, deliberate step via
 * the screening-result form (never auto-derived here).
 *
 * reviewed_at and interpretation_sent_at are set in the SAME update call so
 * the DB trigger (private.enforce_lab_result_document_update) freezes both
 * together and fires the patient's in-app notification exactly once.
 */
export async function markResultDocumentReviewed(input: {
  documentId: string;
  interpretation: string;
  nextSteps?: string;
  note?: string;
}): Promise<ResultUploadResult> {
  const parsed = markResultReviewedSchema.safeParse({
    document_id: input.documentId,
    interpretation: input.interpretation,
    next_steps: input.nextSteps,
    note: input.note,
  });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Invalid input" };
  }
  const { document_id: documentId, interpretation, next_steps: nextSteps, note } = parsed.data;

  const user = await getCurrentUser();
  if (!user) return { error: "Not signed in" };
  const supabase = await createClient();

  const { data: staff } = await supabase
    .from("clinical_staff")
    .select("id")
    .eq("profile_id", user.id)
    .eq("active", true)
    .maybeSingle();
  if (!staff) {
    return { error: "Only a Tarragon care-team doctor can mark a result reviewed." };
  }

  const { data: doc, error: docError } = await supabase
    .from("lab_result_documents")
    .select("id, patient_id, reviewed_at, clinician_alert_id")
    .eq("id", documentId)
    .maybeSingle();
  if (docError || !doc) return { error: "Document not found." };
  if (doc.reviewed_at) return { error: "This result was already marked reviewed." };

  const now = new Date().toISOString();
  const { error: updateError } = await supabase
    .from("lab_result_documents")
    .update({
      reviewed_at: now,
      review_note: note ?? null,
      patient_interpretation: interpretation,
      next_steps: nextSteps ?? null,
      interpretation_sent_at: now,
    })
    .eq("id", documentId);
  if (updateError) return { error: updateError.message };

  // Resolve the linked review alert — best-effort, never blocks the review.
  if (doc.clinician_alert_id) {
    await supabase
      .from("clinician_alerts")
      .update({
        status: "resolved",
        acknowledged_by: user.id,
        acknowledged_at: new Date().toISOString(),
      })
      .eq("id", doc.clinician_alert_id);
  }

  revalidatePath("/clinician");
  revalidatePath(`/clinician/patients/${doc.patient_id}`);
  revalidatePath("/patient/labs");
  return { success: true };
}

/**
 * A partner lab's own logged-in staff (the `lab_partner` account, scoped to a
 * single `lab_providers` row) uploads a result directly for one of ITS OWN
 * orders — the alternative to a lab emailing the Lab Liaison Officer. Mirrors
 * `uploadResultDocumentForPatient`'s storage-then-insert-with-rollback shape,
 * but authorisation is delegated to the SECURITY DEFINER RPCs
 * (`lab_partner_order_patient`/`lab_partner_upload_result`,
 * 20260727002742_lab_partner_surface.sql) rather than this app-layer's own
 * is_org_staff check — a lab partner has no org-staff RLS access at all, by
 * design (see the migration's security model comment).
 */
export async function uploadResultAsLabPartner(
  formData: FormData,
): Promise<ResultUploadResult> {
  const user = await getCurrentUser();
  if (!user) return { error: "Not signed in" };

  const supabase = await createClient();
  const { data: me } = await supabase
    .from("profiles")
    .select("role")
    .eq("id", user.id)
    .single();
  if (me?.role !== "lab_partner") {
    return { error: "This action is for partner labs." };
  }

  const file = formData.get("file");
  if (!(file instanceof File) || file.size === 0) {
    return { error: "Attach the result file (PDF or image)." };
  }
  const fileError = validateResultDocFile(file);
  if (fileError) return { error: fileError };

  const parsed = labPartnerResultUploadSchema.safeParse({
    order_id: formData.get("order_id"),
    note: formData.get("note") || undefined,
  });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Invalid input" };
  }
  const { order_id: orderId, note } = parsed.data;

  // Scoped to the caller's own lab via private.lab_partner_provider() —
  // returns null for another lab's order, so this can't leak a patient_id
  // cross-lab even at the path-building stage.
  const { data: patientId, error: lookupError } = await supabase.rpc(
    "lab_partner_order_patient",
    { p_order_id: orderId },
  );
  if (lookupError || !patientId) {
    return { error: "Order not found for your lab." };
  }

  const service = createServiceRoleClient();
  const ext = EXT_BY_MIME[file.type] ?? "bin";
  const path = `${patientId}/${randomUUID()}.${ext}`;

  const { error: uploadError } = await service.storage
    .from(RESULT_DOC_BUCKET)
    .upload(path, file, { contentType: file.type, upsert: false });
  if (uploadError) return { error: uploadError.message };

  // Re-verifies ownership independently (defence in depth) and derives
  // patient_id/organisation_id itself from the order row — never trusts the
  // lookup above for the write. Also advances the order to 'resulted'.
  const { error: insertError } = await supabase.rpc("lab_partner_upload_result", {
    p_order_id: orderId,
    p_file_path: path,
    p_original_filename: file.name,
    p_mime_type: file.type,
    p_file_size_bytes: file.size,
    p_note: (note ?? null) as unknown as string,
  });
  if (insertError) {
    await service.storage.from(RESULT_DOC_BUCKET).remove([path]);
    return { error: insertError.message };
  }

  revalidatePath("/lab-partner");
  return { success: true };
}
