import { isCronAuthorised } from "@/lib/cron-auth";
import { createServiceRoleClient } from "@/lib/supabase/service-role";
import { retryUnreadLabReports } from "@/lib/clinical-documents/retry";
import { retryStuckClassifications } from "@/lib/clinical-documents/classify-run";
import { rescanHeldCredentialDocuments, rescanHeldUploads, startReadersForClearedUploads } from "@/lib/upload-scan/sweep";

/**
 * Daily retry of uploaded lab reports the automatic reader could not read (clinical document engine step 1). See
 * lib/clinical-documents/retry.ts. Daily because this account's Vercel plan refuses sub-daily crons; a failed read is on the
 * ops exception queue immediately, so nothing waits on this sweep to reach a person.
 *
 * Also finishes sorting "not sure what this is" uploads that were interrupted (step 4, classify-run.ts).
 *
 * T2-08 runs first: documents held for the malware scan (the scanner was down when they arrived) are rescanned, newly clean ones
 * get their reader started, and the ops incident for held documents is refreshed (lib/upload-scan/sweep.ts). Every reader skips
 * a held document, so the order only decides whether a cleared document is read in this run or the next. Clinician credential
 * documents held the same way are rescanned too (they need no reader; a cleared one becomes openable and verifiable).
 *
 * Verifies the Vercel-attached CRON_SECRET bearer, same as the other cron routes.
 */
export async function GET(request: Request): Promise<Response> {
  const authHeader = request.headers.get("authorization");
  if (!isCronAuthorised(authHeader)) {
    return new Response("Not authorised", { status: 401 });
  }
  const service = createServiceRoleClient();
  const scanned = await rescanHeldUploads(service);
  const readersStarted = await startReadersForClearedUploads(service, scanned.cleared);
  const credentialScan = await rescanHeldCredentialDocuments(service);
  const scan = { ...scanned, cleared: scanned.cleared.length, readersStarted, credentialDocuments: credentialScan };
  // Step 4: uploads interrupted while being sorted first, so a document sorted into the lab path here is read in the same run.
  const sorting = await retryStuckClassifications(service);
  const result = await retryUnreadLabReports(service);
  if ("error" in result) return Response.json({ error: result.error, sorting, scan }, { status: 500 });
  // A rescan step that errored (could not list, apply a verdict or delete an infected file; NOT "scanner unavailable", which
  // is a verdict) fails the run, so cron monitoring sees it instead of a 200 with the count buried in the body. Every step
  // above still ran.
  const scanErrors = scanned.errors + credentialScan.errors;
  if (scanErrors > 0) {
    console.error("clinical-document-retry: malware rescan had errors", { uploads: scanned.errors, credentialDocuments: credentialScan.errors });
    return Response.json({ ...result, sorting, scan, error: `malware rescan had ${scanErrors} error(s)` }, { status: 500 });
  }
  return Response.json({ ...result, sorting, scan });
}
