import { getProposedConfig } from "@tarragon/shared";

// Kept out of skin-photo-actions.ts on purpose: a "use server" file may export only async functions, and these are a constant, a type
// and a plain function that the card and the actions both read.
export type SkinPhotoPolicy = { max_bytes: number; allowed_types: string[]; max_open_per_patient: number; retention_days_unreviewed: number; retention_days_after_review: number; signed_url_seconds: number };
export const BODY_AREAS = ["face", "scalp", "neck", "chest_or_back", "abdomen", "arm_or_hand", "leg_or_foot", "eye", "mouth_or_ear", "other"] as const;
export type BodyArea = (typeof BODY_AREAS)[number];

export function skinPhotoPolicy(): SkinPhotoPolicy {
  return getProposedConfig("symptom.skin_photo_policy").value as unknown as SkinPhotoPolicy;
}
