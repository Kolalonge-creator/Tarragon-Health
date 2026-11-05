import { z } from "zod";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@tarragon/shared";
import { createServiceRoleClient } from "@/lib/supabase/service-role";
import { runClientUploadChecks } from "./verify-stored-upload";

/**
 * "Check the file I just uploaded" (security audit 2026-11-05, M-4/L-4). Web and phone flows that write straight to Storage
 * ask for this right after the upload, so their file is checked within seconds instead of waiting for the sweep. Best effort:
 * a client that never asks (offline, an old build, or someone calling the Storage API directly) is still caught by the sweep,
 * because the storage.objects trigger queued the file whatever the client did.
 *
 * Only the user who wrote the object can ask for it to be checked (claim_client_upload_checks matches owner_id).
 */
export const uploadCheckSchema = z.object({
  bucket: z.string().min(1).max(100),
  path: z.string().min(1).max(1024),
});

export type UploadCheckResult = { checked: boolean; refused: boolean } | { error: string };

export async function checkMyUpload(userClient: SupabaseClient<Database>, input: unknown, accessToken?: string): Promise<UploadCheckResult> {
  const parsed = uploadCheckSchema.safeParse(input);
  if (!parsed.success) return { error: "Invalid request" };
  const {
    data: { user },
  } = accessToken ? await userClient.auth.getUser(accessToken) : await userClient.auth.getUser();
  if (!user) return { error: "Not signed in" };

  const service = createServiceRoleClient();
  const only = { bucket: parsed.data.bucket, name: parsed.data.path, ownerId: user.id };
  const result = await runClientUploadChecks(service, { limit: 1, only });
  if ("error" in result) return { error: "Could not check the file" };
  if (result.outcomes.quarantined > 0) return { checked: true, refused: true };
  if (result.checked === 0) {
    // Already checked by the sweep (or a retry): report a refusal it made, so the screen never points at a removed file.
    const { data } = await service.rpc("client_upload_check_outcome", { p_bucket: only.bucket, p_name: only.name, p_owner: only.ownerId });
    return { checked: false, refused: data === "quarantined" };
  }
  // A refused file is reported so the screen can say so; nothing else about the check is shared.
  return { checked: true, refused: false };
}
