import { renderToBuffer } from "@react-pdf/renderer";
import { t } from "@tarragon/i18n";
import { createClient } from "@/lib/supabase/server";
import { getCaregiverReport } from "@/lib/health-report/caregiver";
import { buildRenderModel } from "@/lib/health-report/render-model";
import { HealthReportDocument } from "@/lib/health-report/health-report-document";

/**
 * The printable A4 black-and-white copy of a dependant's SIGNED report for a caregiver or guardian (S46c). The caller's own session is used and the database
 * function decides what they may see (access categories, adolescent confidentiality, hand-over at 18), so every refusal is the same 404.
 * `?variant=shared` builds the shared copy. The report never contains HIV or hepatitis results.
 */
export async function GET(request: Request, { params }: { params: Promise<{ patientId: string }> }): Promise<Response> {
  const { patientId } = await params;
  if (!/^[0-9a-f-]{36}$/.test(patientId)) return new Response("Not found", { status: 404 });
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return new Response("Not signed in", { status: 401 });

  const report = await getCaregiverReport(supabase, patientId);
  if (!report) return new Response("Not found", { status: 404 });

  const variant = new URL(request.url).searchParams.get("variant") === "shared" ? "shared" : "self";
  const model = buildRenderModel(report.row, report.config, variant, [], report.caregiver);
  const buffer = await renderToBuffer(HealthReportDocument({ model, standingLine: t("disclaimer.screening.standing", "en") }));
  return new Response(new Uint8Array(buffer), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `attachment; filename="tarragon-health-report-${report.row.year}${variant === "shared" ? "-shared" : ""}.pdf"`,
      "Cache-Control": "private, no-store",
    },
  });
}
