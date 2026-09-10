import { createClient } from "@/lib/supabase/server";
import { generatePreventiveCarePlanPdf } from "@/lib/preventive-care/generate-preventive-care-plan-pdf";

/**
 * The take-anywhere preventive & chronic-care plan, cookie-session auth.
 *
 * `patientId` defaults to the caller's own id, but a parent/guardian viewing
 * a dependent's record (see getPatientDashboardContext's subjectId) can pass
 * that dependent's id instead — safe because every read inside
 * generatePreventiveCarePlanPdf goes through this same session's RLS, so a
 * patientId the caller has no consent to see returns no profile and this
 * 404s, exactly like the lab request and referral letter routes.
 *
 * Never gated by plan — screening/vaccination coordination is free on every
 * plan (see prevention hub's screeningBookingEnabled), and a patient must
 * always be able to see and print what is currently due.
 */
export async function GET(request: Request): Promise<Response> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return new Response("Not signed in", { status: 401 });

  const url = new URL(request.url);
  const patientId = url.searchParams.get("patientId") ?? user.id;

  const result = await generatePreventiveCarePlanPdf(supabase, patientId);
  if (!result.ok) return new Response("Not found", { status: 404 });

  return new Response(new Uint8Array(result.buffer), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `attachment; filename="${result.filename}"`,
      "Cache-Control": "no-store",
    },
  });
}
