import { renderToBuffer } from "@react-pdf/renderer";
import { createClient } from "@/lib/supabase/server";
import { z } from "zod";
import { getGlucoseDisplayUnit } from "@/lib/patient/glucose-unit";
import {
  ALLOWED_PERIOD_DAYS,
  VISIT_REPORT_FIELDS,
  summariseReadings,
} from "@/lib/visit-report/summarise";
import { VisitReportDocument } from "@/lib/visit-report/visit-report-document";

/**
 * "Report for your visit": the signed-in patient's own logged readings over
 * the last 7/30/90 days as a one-page PDF. Read through the caller's own
 * RLS-scoped session and filtered to their own id, so there is no way to ask
 * for someone else's readings. Plain statistics only, see lib/visit-report.
 *
 * ?days=7|30|90 (anything else is 30)
 */
const READING_CAP = 5000;

/** ?days is 7, 30 or 90; anything else, or nothing, means 30. */
const querySchema = z.object({
  days: z
    .string()
    .nullable()
    .transform((v) => Number(v))
    .pipe(z.number().refine((n) => (ALLOWED_PERIOD_DAYS as readonly number[]).includes(n)))
    .catch(30),
});

export async function GET(request: Request): Promise<Response> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return new Response("Not signed in", { status: 401 });

  const { days } = querySchema.parse({ days: new URL(request.url).searchParams.get("days") });
  const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();

  const { data: profile } = await supabase
    .from("profiles")
    .select("full_name, role")
    .eq("id", user.id)
    .maybeSingle();
  if (!profile || profile.role !== "patient") return new Response("Not found", { status: 404 });

  const { data: readings, error } = await supabase
    .from("vitals_readings")
    .select(VISIT_REPORT_FIELDS)
    .eq("patient_id", user.id)
    .gte("taken_at", since)
    // Newest first so the cap drops the oldest rows, never the latest.
    .order("taken_at", { ascending: false })
    .limit(READING_CAP);
  if (error) return new Response("Could not load readings", { status: 500 });

  const rows = readings ?? [];
  const summary = summariseReadings(rows, days);
  const glucoseUnit = await getGlucoseDisplayUnit();
  const buffer = await renderToBuffer(
    VisitReportDocument({
      data: {
        patientName: profile.full_name ?? "Patient",
        generatedAt: new Date().toISOString(),
        summary,
        glucoseUnit,
        truncated: rows.length >= READING_CAP,
      },
    }),
  );

  return new Response(new Uint8Array(buffer), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `attachment; filename="tarragon-visit-report-${days}d.pdf"`,
      "Cache-Control": "private, no-store",
    },
  });
}
