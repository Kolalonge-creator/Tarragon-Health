import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { exportIpsBundle } from "@/lib/fhir/export-service";

/**
 * GET /api/patient/ips-export?patient=<uuid>
 *
 * An International Patient Summary shaped FHIR R4 document Bundle, as a download. It is built from the same database snapshot as
 * `/api/patient/fhir-export`, so every rule about who may export and what is included is the database's (the person; a supporter only for the
 * categories they hold). It takes no staff `reason`: a written justification does not belong in a URL, and the summary is the person's own tool, so
 * staff use the audited clinician export instead. Every call writes an audit row in `fhir_export_log`. Reproductive health and mental health are
 * not sections, documents are left out, and results are released ones only. The file is "IPS-shaped": it makes no claim to conform
 * to the IPS implementation guide or to Nigeria Core, and it has not been run through a validator.
 */
const querySchema = z.object({
  patient: z.string().uuid().optional(),
});

export async function GET(request: Request): Promise<Response> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return new Response("Not signed in", { status: 401 });

  const parsed = querySchema.safeParse(Object.fromEntries(new URL(request.url).searchParams));
  if (!parsed.success) return Response.json({ error: "Invalid request" }, { status: 400 });

  const outcome = await exportIpsBundle(supabase, { patientId: parsed.data.patient ?? user.id });
  if (!outcome.ok) return Response.json({ error: outcome.error }, { status: outcome.status });

  return new Response(JSON.stringify(outcome.result.bundle), {
    headers: {
      "Content-Type": "application/fhir+json; charset=utf-8",
      "Content-Disposition": 'attachment; filename="health-summary-ips.fhir.json"',
      "Cache-Control": "no-store",
      "X-Export-Sections": outcome.sectionsIncluded.join(","),
      "X-Export-Skipped": String(outcome.result.skipped.length),
      "X-Ips-Mapping-Version": String(outcome.ipsMappingVersion),
    },
  });
}
