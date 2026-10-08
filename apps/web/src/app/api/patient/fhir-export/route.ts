import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { exportFhirBundle } from "@/lib/fhir/export-service";

/**
 * GET /api/patient/fhir-export?patient=<uuid>&sections=vitals,lab_results&reason=<staff only>
 *
 * A FHIR R4 Bundle (Patient, Observation, MedicationStatement, Condition, Immunization, DocumentReference; allergies too) of the record, as a
 * download. Cookie-session auth, like the PDF route beside it. `patient` defaults to the signed-in person. Every rule about who may export and
 * what is included is enforced by the database function behind it (the person; a supporter only for the categories they hold; staff only
 * through the tie with a written reason and an audit row). A refusal is a plain 403 that does not say whether the person exists.
 * Reproductive health and mental health are not sections and are named as excluded in the bundle's own tags.
 */
const querySchema = z.object({
  patient: z.string().uuid().optional(),
  sections: z.string().max(200).optional(),
  reason: z.string().max(500).optional(),
});

export async function GET(request: Request): Promise<Response> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return new Response("Not signed in", { status: 401 });

  const params = Object.fromEntries(new URL(request.url).searchParams);
  const parsed = querySchema.safeParse(params);
  if (!parsed.success) return Response.json({ error: "Invalid request" }, { status: 400 });

  const outcome = await exportFhirBundle(supabase, {
    patientId: parsed.data.patient ?? user.id,
    sections: parsed.data.sections ? parsed.data.sections.split(",").map((s) => s.trim()) : undefined,
    reason: parsed.data.reason,
  });
  if (!outcome.ok) return Response.json({ error: outcome.error }, { status: outcome.status });

  return new Response(JSON.stringify(outcome.result.bundle), {
    headers: {
      "Content-Type": "application/fhir+json; charset=utf-8",
      "Content-Disposition": 'attachment; filename="health-record.fhir.json"',
      "Cache-Control": "no-store",
      "X-Export-Sections": outcome.sectionsIncluded.join(","),
      "X-Export-Skipped": String(outcome.result.skipped.length),
    },
  });
}
