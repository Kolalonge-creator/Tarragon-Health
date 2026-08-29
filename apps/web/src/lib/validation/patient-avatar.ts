/** Accepted patient profile-photo types + 5 MB cap — mirrors the
 * 'patient-avatars' bucket's own allowed_mime_types/file_size_limit. */
export const PATIENT_AVATAR_ACCEPT = "image/jpeg,image/png,image/webp";
const PATIENT_AVATAR_MAX_BYTES = 5 * 1024 * 1024;
const PATIENT_AVATAR_MIME = new Set(["image/jpeg", "image/png", "image/webp"]);

export function validatePatientAvatarFile(file: File): string | null {
  if (!PATIENT_AVATAR_MIME.has(file.type)) {
    return "Upload a photo (JPG, PNG, or WEBP)";
  }
  if (file.size > PATIENT_AVATAR_MAX_BYTES) {
    return "That photo is larger than 5 MB — try a smaller one";
  }
  return null;
}
