import { createServiceRoleClient } from "@/lib/supabase/service-role";
import { runClientUploadChecks } from "@/lib/uploads/verify-stored-upload";

/**
 * Checks files a browser or the phone app wrote straight to Storage (security audit 2026-11-05, M-4/L-4): bytes must match the
 * declared type, photo location is removed, a mismatch is quarantined. See lib/uploads/verify-stored-upload.ts.
 *
 * Called every two minutes by pg_cron (private.kick_client_upload_checks, POST, once the app_base_url and cron_secret Vault
 * secrets exist) and daily by Vercel cron (GET) as a backstop. Both carry the CRON_SECRET bearer.
 */
async function handle(request: Request): Promise<Response> {
  const authHeader = request.headers.get("authorization");
  if (!process.env.CRON_SECRET || authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return new Response("Not authorised", { status: 401 });
  }
  const service = createServiceRoleClient();
  let checked = 0;
  const totals = { clean: 0, cleaned: 0, quarantined: 0, gone: 0, error: 0 };
  // Batches until 40 seconds have passed, well inside the function time limit; anything left is taken by the next run (two
  // minutes later from pg_cron), and a row interrupted mid-check is reclaimed after ten minutes.
  const deadline = Date.now() + 40_000;
  while (Date.now() < deadline) {
    const result = await runClientUploadChecks(service, { limit: 10 });
    if ("error" in result) return Response.json({ error: result.error, checked, totals }, { status: 500 });
    checked += result.checked;
    for (const [k, v] of Object.entries(result.outcomes)) totals[k as keyof typeof totals] += v;
    if (result.checked < 10) break;
  }
  return Response.json({ checked, totals });
}

export const GET = handle;
export const POST = handle;
