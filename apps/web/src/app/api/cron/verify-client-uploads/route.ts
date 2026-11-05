import { z } from "zod";
import { isCronAuthorised } from "@/lib/cron-auth";
import { createServiceRoleClient } from "@/lib/supabase/service-role";
import { runClientUploadChecks } from "@/lib/uploads/verify-stored-upload";

/**
 * Checks files a browser or the phone app wrote straight to Storage (security audit 2026-11-05, M-4/L-4): bytes must match the
 * declared type, photo location is removed, a mismatch is quarantined. See lib/uploads/verify-stored-upload.ts.
 *
 * Two callers, two proofs:
 * - pg_cron every two minutes (private.kick_client_upload_checks, POST) sends a one-time code in x-upload-check-kick. The code
 *   is accepted only if public.consume_client_upload_check_kick spends it (made by the database in the last ten minutes, never
 *   used before), so no shared secret has to be copied into the database.
 * - Vercel cron daily (GET) as a backstop, with the CRON_SECRET bearer.
 */
const kickCodeSchema = z.string().uuid();

async function isAuthorised(request: Request): Promise<boolean> {
  if (isCronAuthorised(request.headers.get("authorization"))) return true;
  const code = kickCodeSchema.safeParse(request.headers.get("x-upload-check-kick"));
  if (!code.success) return false;
  const { data, error } = await createServiceRoleClient().rpc("consume_client_upload_check_kick", { p_code: code.data });
  return !error && data === true;
}

async function handle(request: Request): Promise<Response> {
  if (!(await isAuthorised(request))) {
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
