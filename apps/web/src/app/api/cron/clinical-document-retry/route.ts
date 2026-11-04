import { createServiceRoleClient } from "@/lib/supabase/service-role";
import { retryUnreadLabReports } from "@/lib/clinical-documents/retry";

/**
 * Daily retry of uploaded lab reports the automatic reader could not read (clinical document engine step 1). See
 * lib/clinical-documents/retry.ts. Daily because this account's Vercel plan refuses sub-daily crons; a failed read is on the
 * ops exception queue immediately, so nothing waits on this sweep to reach a person.
 *
 * Verifies the Vercel-attached CRON_SECRET bearer, same as the other cron routes.
 */
export async function GET(request: Request): Promise<Response> {
  const authHeader = request.headers.get("authorization");
  if (!process.env.CRON_SECRET || authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return new Response("Not authorised", { status: 401 });
  }
  const result = await retryUnreadLabReports(createServiceRoleClient());
  if ("error" in result) return Response.json({ error: result.error }, { status: 500 });
  return Response.json(result);
}
