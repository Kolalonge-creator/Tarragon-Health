"use server";

import { randomUUID } from "node:crypto";
import * as Sentry from "@sentry/nextjs";
import { BODY_AREAS, skinPhotoPolicy } from "./skin-photo-config";
import { t } from "@tarragon/i18n";
import { createClient } from "@/lib/supabase/server";
import { createServiceRoleClient } from "@/lib/supabase/service-role";
import { resolveSubjectId } from "@/lib/acting/acting-for";
import { isSymptomCheckerOpen } from "@/lib/symptom-triage/protocol";
import { stripImageMetadata } from "@/lib/symptom-triage/strip-image-metadata";

/**
 * Photos of a visible problem for the care team to look at (spec 12.7). The server (never the browser) writes the file: it checks the
 * size and the real file type from the bytes, strips the image metadata, stores it in the private bucket under the patient's own
 * folder, and then asks the database to register it (consent, limits, retention, the review task). Nothing here reads the image or
 * scores it. Closed means closed: while symptom_checker_enabled is off nothing is stored (and the database refuses as well).
 */
export type UploadSkinPhotoResult =
  | { status: "sent"; photoId: string }
  | { status: "unavailable" }
  | { status: "error"; reason: "too_big" | "bad_type" | "too_many" | "consent" | "other" };

export async function uploadSkinPhoto(formData: FormData): Promise<UploadSkinPhotoResult> {
  if (!(await isSymptomCheckerOpen())) return { status: "unavailable" };
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { status: "unavailable" };

  const file = formData.get("photo");
  const area = String(formData.get("body_area") ?? "");
  const note = String(formData.get("note") ?? "").slice(0, 500);
  const assessmentRaw = formData.get("assessment_id");
  const assessment = typeof assessmentRaw === "string" && /^[0-9a-f-]{36}$/i.test(assessmentRaw) ? assessmentRaw : null;
  if (formData.get("consent") !== "on") return { status: "error", reason: "consent" };
  if (!(file instanceof File) || !(BODY_AREAS as readonly string[]).includes(area)) return { status: "error", reason: "other" };

  const policy = skinPhotoPolicy();
  if (file.size <= 0 || file.size > policy.max_bytes) return { status: "error", reason: "too_big" };
  const clean = stripImageMetadata(new Uint8Array(await file.arrayBuffer()));
  if (!clean || !policy.allowed_types.includes(clean.contentType)) return { status: "error", reason: "bad_type" };
  if (clean.bytes.length > policy.max_bytes) return { status: "error", reason: "too_big" };

  const subjectId = await resolveSubjectId(user.id);
  const path = `${subjectId}/${randomUUID()}.${clean.extension}`;
  const service = createServiceRoleClient();
  const { error: upErr } = await service.storage.from("skin-photos").upload(path, clean.bytes, { contentType: clean.contentType, upsert: false });
  if (upErr) {
    Sentry.captureException(new Error(`skin photo upload failed: ${upErr.message}`));
    return { status: "error", reason: "other" };
  }
  const { data, error } = await supabase.rpc("register_skin_photo", {
    p_patient: subjectId,
    p_storage_path: path,
    p_body_area: area,
    p_note: note,
    p_consent_shown: true,
    p_consent_text_version: t("symptom.skin.consent_version"),
    ...(assessment ? { p_assessment: assessment } : {}),
  });
  if (error || !data) {
    // never leave a stored file with no record: remove it, and say why
    await service.storage.from("skin-photos").remove([path]);
    if (error?.code === "42501") return { status: "unavailable" };
    if (error?.code === "22023" && /too many/.test(error.message)) return { status: "error", reason: "too_many" };
    Sentry.captureException(new Error(`skin photo could not be registered: ${error?.message ?? "no row"}`));
    return { status: "error", reason: "other" };
  }
  return { status: "sent", photoId: (data as { photo_id: string }).photo_id };
}

export type MySkinPhoto = { id: string; bodyArea: string; status: string; message: string | null; createdAt: string; url: string | null };

/** The photos the person (or the one they act for) has sent, with a short-lived link to look at each, read under their own session. */
export async function listMySkinPhotos(): Promise<MySkinPhoto[]> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return [];
  const subjectId = await resolveSubjectId(user.id);
  const { data } = await supabase
    .from("skin_photos")
    .select("id, body_area, status, clinician_message, created_at, storage_path")
    .eq("patient_id", subjectId)
    .in("status", ["submitted", "reviewed"])
    .order("created_at", { ascending: false })
    .limit(10);
  const secs = skinPhotoPolicy().signed_url_seconds;
  return Promise.all(
    (data ?? []).map(async (r) => {
      const { data: signed } = await supabase.storage.from("skin-photos").createSignedUrl(r.storage_path, secs);
      return { id: r.id, bodyArea: r.body_area, status: r.status, message: r.clinician_message, createdAt: r.created_at, url: signed?.signedUrl ?? null };
    }),
  );
}

/** Take a photo back: the record says withdrawn, the file is removed from storage at once, and the record is marked purged. */
export async function withdrawSkinPhoto(photoId: string): Promise<{ ok: boolean }> {
  if (!/^[0-9a-f-]{36}$/i.test(photoId)) return { ok: false };
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("withdraw_skin_photo", { p_photo: photoId });
  if (error || !data) return { ok: false };
  const path = (data as { storage_path?: string }).storage_path;
  if (path) {
    const service = createServiceRoleClient();
    const { error: rmErr } = await service.storage.from("skin-photos").remove([path]);
    if (rmErr) {
      // the record already says withdrawn and the retention list will show it as due; report it, do not pretend
      Sentry.captureException(new Error(`withdrawn skin photo could not be removed from storage: ${rmErr.message}`));
      return { ok: true };
    }
    await service.rpc("mark_skin_photo_purged", { p_photo: photoId });
  }
  return { ok: true };
}
