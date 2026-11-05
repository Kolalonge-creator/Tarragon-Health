import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@tarragon/shared";
import { confirmDirectUpload } from "@/lib/uploads/confirm-direct-upload";

export const MEAL_PHOTO_BUCKET = "meal-photos";

/**
 * The web meal log writes the photo straight to Storage under the person's own folder, then asks the server to check it
 * (security audit 2026-11-05, M-4/L-4: real bytes match the type, photo location removed) before the meal points at it.
 * Returns the stored path; throws when the upload fails or the server refused the file.
 */
export async function uploadMealPhoto(supabase: SupabaseClient<Database>, userId: string, file: File): Promise<string> {
  const ext = file.name.split(".").pop()?.toLowerCase() ?? "jpg";
  const path = `${userId}/${crypto.randomUUID()}.${ext}`;
  const { error } = await supabase.storage.from(MEAL_PHOTO_BUCKET).upload(path, file, { contentType: file.type, upsert: false });
  if (error) throw error;
  const refused = await confirmDirectUpload(MEAL_PHOTO_BUCKET, path);
  if (refused) throw new Error(refused);
  return path;
}
