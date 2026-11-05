import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@tarragon/shared";
import { confirmDirectUpload } from "@/lib/uploads/confirm-direct-upload";

export const CLINICAL_STAFF_PHOTO_BUCKET = "clinical-staff-photos";

/**
 * Uploads to the public clinical-staff-photos bucket and returns the public URL for clinical_staff.photo_url. The browser writes
 * the file straight to Storage, then the server checks it (security audit 2026-11-05, M-4/L-4: real bytes match the type,
 * photo location removed; a public photo that cannot be cleaned is refused) before the staff record points at it.
 */
export async function uploadClinicalStaffPhoto(supabase: SupabaseClient<Database>, organisationId: string, file: File): Promise<string> {
  const ext = file.name.split(".").pop()?.toLowerCase() || "jpg";
  const path = `${organisationId}/${crypto.randomUUID()}.${ext}`;
  const { error } = await supabase.storage.from(CLINICAL_STAFF_PHOTO_BUCKET).upload(path, file, { contentType: file.type, upsert: false });
  if (error) throw error;
  const refused = await confirmDirectUpload(CLINICAL_STAFF_PHOTO_BUCKET, path);
  if (refused) throw new Error(refused);
  return supabase.storage.from(CLINICAL_STAFF_PHOTO_BUCKET).getPublicUrl(path).data.publicUrl;
}
