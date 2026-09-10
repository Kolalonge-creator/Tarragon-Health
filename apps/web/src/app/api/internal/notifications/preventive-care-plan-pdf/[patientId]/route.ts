import "server-only";
import { createServiceRoleClient } from "@/lib/supabase/service-role";
import { generatePreventiveCarePlanPdf } from "@/lib/preventive-care/generate-preventive-care-plan-pdf";

/**
 * Internal-only: hands the send-pending-notifications Edge Function the same
 * preventive care plan PDF a patient can download themselves, so the
 * automatic "your preventive care plan" email can carry it as an
 * attachment. Same shape as
 * api/internal/notifications/lab-order-request-pdf/[orderId] — see that
 * route's own comment for why this needs a shared secret rather than a
 * cookie session, and why an RLS-bypassing service-role read is only safe
 * because nothing reaches this route without NOTIFICATIONS_SERVICE_KEY.
 *
 * Takes the patient's own id directly (not a notification/order id) —
 * unlike the lab request, recipient_id on this notification already IS the
 * patient, so the caller (send-pending-notifications) passes row.recipient_id
 * straight through with no payload field needed for it.
 */
export async function GET(
  request: Request,
  { params }: { params: Promise<{ patientId: string }> },
): Promise<Response> {
  const expected = process.env.NOTIFICATIONS_SERVICE_KEY;
  const provided = request.headers.get("x-service-key");
  if (!expected || !provided || provided !== expected) {
    return new Response(null, { status: 401 });
  }

  const { patientId } = await params;
  const supabase = createServiceRoleClient();
  const result = await generatePreventiveCarePlanPdf(supabase, patientId);
  if (!result.ok) return new Response(null, { status: 404 });

  return new Response(new Uint8Array(result.buffer), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `attachment; filename="${result.filename}"`,
      "Cache-Control": "no-store",
    },
  });
}
