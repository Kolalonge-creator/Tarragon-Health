import { isCronAuthorised } from "@/lib/cron-auth";
import { createServiceRoleClient } from "@/lib/supabase/service-role";
import { retryUnreadLabReports } from "@/lib/clinical-documents/retry";
import { retryStuckClassifications } from "@/lib/clinical-documents/classify-run";

/**
 * Daily retry of uploaded lab reports the automatic reader could not read (clinical document engine step 1). See
 * lib/clinical-documents/retry.ts. Daily because this account's Vercel plan refuses sub-daily crons; a failed read is on the
 * ops exception queue immediately, so nothing waits on this sweep to reach a person.
 *
 * Also finishes sorting "not sure what this is" uploads that were interrupted (step 4, classify-run.ts).
 *
 * Verifies the Vercel-attached CRON_SECRET bearer, same as the other cron routes.
 */
export async function GET(request: Request): Promise<Response> {
  const authHeader = request.headers.get("authorization");
  if (!isCronAuthorised(authHeader)) {
    return new Response("Not authorised", { status: 401 });
  }
  const service = createServiceRoleClient();
  // Step 4: uploads interrupted while being sorted first, so a document sorted into the lab path here is read in the same run.
  const sorting = await retryStuckClassifications(service);
  const result = await retryUnreadLabReports(service);
  if ("error" in result) return Response.json({ error: result.error, sorting }, { status: 500 });
  return Response.json({ ...result, sorting });
}
