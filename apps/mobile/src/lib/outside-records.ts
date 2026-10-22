import { outsideRecordLabel, type OutsideRecordLabel } from "@tarragon/shared";
import { supabase } from "./supabase";

/** Mirrors the bucket's own limits (private patient-documents bucket: 10 MB, images and PDF). The bucket enforces them again. */
export const OUTSIDE_RECORD_MAX_BYTES = 10 * 1024 * 1024;
export const OUTSIDE_RECORD_MIME_TYPES = ["image/jpeg", "image/png", "image/webp", "image/heic", "application/pdf"] as const;

export type OutsideRecordType = "previous_hospital_record" | "discharge_summary" | "prescription" | "specialist_letter" | "vaccination_card" | "other";

export interface OutsideRecordRow {
  id: string;
  documentType: string;
  filename: string | null;
  createdAt: string;
  label: OutsideRecordLabel;
}

export type LoadOutsideRecordsResult = { ok: true; rows: OutsideRecordRow[] } | { ok: false };

/**
 * The person's own records from other hospitals, each with what it may say about itself: "supplied by you, not yet checked" until a care-team doctor
 * checks it. The checking doctor's name comes from the public staff directory; if that lookup fails the line says "your care team", never a guess.
 * A failed read is `{ ok: false }`, never an empty list.
 */
export async function loadOutsideRecords(patientId: string): Promise<LoadOutsideRecordsResult> {
  const { data, error } = await supabase
    .from("patient_documents")
    .select("id, document_type, original_filename, created_at, source, verification_status, reviewed_by, reviewed_at, review_note")
    .eq("patient_id", patientId)
    .eq("source", "patient")
    .order("created_at", { ascending: false })
    .limit(50);
  if (error || !data) return { ok: false };
  const ids = [...new Set(data.map((d) => d.reviewed_by).filter((id): id is string => !!id))];
  const names = new Map<string, string | null>();
  if (ids.length > 0) {
    const { data: staff } = await supabase.from("clinical_staff_directory").select("profile_id, full_name").in("profile_id", ids);
    for (const s of staff ?? []) if (s.profile_id) names.set(s.profile_id, s.full_name);
  }
  return {
    ok: true,
    rows: data.map((d) => ({
      id: d.id,
      documentType: d.document_type,
      filename: d.original_filename,
      createdAt: d.created_at,
      label: outsideRecordLabel({
        status: d.verification_status,
        reviewerName: d.reviewed_by ? (names.get(d.reviewed_by) ?? null) : null,
        reviewedBy: d.reviewed_by,
        reviewedAt: d.reviewed_at,
        note: d.review_note,
      }),
    })),
  };
}

export type UploadOutsideRecordResult = { ok: true } | { ok: false; reason: "too_big" | "type" | "no_session" | "organisation" | "upload" | "insert" };

/**
 * Stores a photo or file from another hospital as the patient's own, unchecked record. Same path as the web: the private bucket under the person's own
 * folder, then a patient_documents row with source 'patient'. The database sets it unchecked and clears any reviewer; nothing here can make it checked,
 * and nothing is read out of the file (no text recognition, no write to the clinical record).
 */
export async function uploadOutsideRecord(
  file: { uri: string; mimeType: string; fileName: string; sizeBytes?: number | null },
  type: OutsideRecordType,
): Promise<UploadOutsideRecordResult> {
  if (!(OUTSIDE_RECORD_MIME_TYPES as readonly string[]).includes(file.mimeType)) return { ok: false, reason: "type" };
  if (file.sizeBytes != null && file.sizeBytes > OUTSIDE_RECORD_MAX_BYTES) return { ok: false, reason: "too_big" };
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, reason: "no_session" };
  const { data: profile } = await supabase.from("profiles").select("organisation_id").eq("id", user.id).maybeSingle();
  if (!profile?.organisation_id) return { ok: false, reason: "organisation" };

  let bytes: ArrayBuffer;
  try {
    bytes = await (await fetch(file.uri)).arrayBuffer();
  } catch {
    return { ok: false, reason: "upload" };
  }
  if (bytes.byteLength > OUTSIDE_RECORD_MAX_BYTES) return { ok: false, reason: "too_big" };

  const ext = file.mimeType === "application/pdf" ? "pdf" : (file.fileName.split(".").pop()?.toLowerCase().replace(/[^a-z0-9]/g, "") || "jpg").slice(0, 5);
  const path = `${user.id}/${globalThis.crypto.randomUUID()}.${ext}`;
  const { error: uploadError } = await supabase.storage.from("patient-documents").upload(path, bytes, { contentType: file.mimeType, upsert: false });
  if (uploadError) return { ok: false, reason: "upload" };
  const { error: insertError } = await supabase.from("patient_documents").insert({
    organisation_id: profile.organisation_id,
    patient_id: user.id,
    document_type: type,
    file_path: path,
    original_filename: file.fileName.slice(0, 200),
    mime_type: file.mimeType,
    file_size_bytes: bytes.byteLength,
    source: "patient",
    ocr_state: null,
  });
  if (insertError) {
    // The file is stored but has no row: remove it so a failed save leaves nothing behind that no one can see.
    await supabase.storage.from("patient-documents").remove([path]);
    return { ok: false, reason: "insert" };
  }
  return { ok: true };
}
