"use server";

import { createClient } from "@/lib/supabase/server";
import { checkMyUpload, type UploadCheckResult } from "./check-my-upload";

/** Web: called right after a browser writes a file straight to Storage. See check-my-upload.ts. */
export async function checkMyUploadAction(input: { bucket: string; path: string }): Promise<UploadCheckResult> {
  return checkMyUpload(await createClient(), input);
}
