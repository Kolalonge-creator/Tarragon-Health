import "server-only";
import { createServiceRoleClient } from "@/lib/supabase/service-role";
import { generateLabRequestPdf } from "@/lib/lab-results/generate-lab-request-pdf";

/**
 * Internal-only: hands the send-pending-notifications Edge Function the same
 * test request PDF a patient can download themselves, so the automatic
 * "your test request is ready" email can carry it as an attachment.
 *
 * WHY THIS EXISTS AS A SEPARATE ROUTE RATHER THAN REUSING THE PATIENT ONE.
 * The Edge Function has no patient session — it holds only the project's own
 * service-role key, from a Postgres trigger's insert into `notifications`. It
 * cannot present a cookie, so the patient-facing route's session check would
 * simply 401 it. This route accepts a shared secret instead
 * (NOTIFICATIONS_SERVICE_KEY, sent as X-Service-Key — the same header name and
 * env-var shape as packages/shared/src/ml-client.ts's ML_SERVICE_KEY, so this
 * codebase has exactly one internal-service-auth idiom, not two), and reads
 * with the SERVICE-ROLE client, which bypasses RLS entirely.
 *
 * That RLS bypass is only safe because nothing about this route is reachable
 * without the secret: there is no code path from a browser or a patient
 * session to here. Never relax the secret check to "or a valid patient
 * session" — that would reintroduce a second, weaker way to hit an
 * RLS-bypassing read.
 *
 * A missing or wrong secret returns 401 with no body, not a hint about why —
 * this endpoint should look identical to "does not exist" from the outside.
 */
export async function GET(
  request: Request,
  { params }: { params: Promise<{ orderId: string }> },
): Promise<Response> {
  const expected = process.env.NOTIFICATIONS_SERVICE_KEY;
  const provided = request.headers.get("x-service-key");
  if (!expected || !provided || provided !== expected) {
    return new Response(null, { status: 401 });
  }

  const { orderId } = await params;
  const supabase = createServiceRoleClient();
  const result = await generateLabRequestPdf(supabase, orderId);
  if (!result.ok) return new Response(null, { status: 404 });

  return new Response(new Uint8Array(result.buffer), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `attachment; filename="${result.filename}"`,
      // The Edge Function fetches this once, right after the notification is
      // queued, and never again for the same order — nothing downstream
      // should cache a stale copy.
      "Cache-Control": "no-store",
    },
  });
}
