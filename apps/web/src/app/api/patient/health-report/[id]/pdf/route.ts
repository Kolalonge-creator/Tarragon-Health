import { renderToBuffer } from "@react-pdf/renderer";
import { t } from "@tarragon/i18n";
import { createClient } from "@/lib/supabase/server";
import { getSignedReport } from "@/lib/health-report/queries";
import { buildRenderModel } from "@/lib/health-report/render-model";
import { HealthReportDocument } from "@/lib/health-report/health-report-document";

/**
 * The printable A4 black-and-white copy of a SIGNED yearly report (S46). The caller's own session is used, so row level security returns nothing for an
 * unsigned draft or for another person's report and this answers 404 either way.
 *
 * `?variant=shared` builds the copy for sharing: reproductive-health screening, the risk band and questionnaire answers are left out unless named in
 * `include` (comma separated: risk, questionnaires, screening_reproductive). HIV, hepatitis and other held results are never in a report at all.
 */
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }): Promise<Response> {
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/.test(id)) return new Response("Not found", { status: 404 });
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return new Response("Not signed in", { status: 401 });

  const report = await getSignedReport(supabase, id);
  if (!report) return new Response("Not found", { status: 404 });

  const url = new URL(request.url);
  const variant = url.searchParams.get("variant") === "shared" ? "shared" : "self";
  const include = (url.searchParams.get("include") ?? "").split(",").filter((x) => ["risk", "questionnaires", "screening_reproductive"].includes(x));
  const model = buildRenderModel(report.row, report.config, variant, include);
  const buffer = await renderToBuffer(HealthReportDocument({ model, standingLine: t("disclaimer.screening.standing", "en") }));
  return new Response(new Uint8Array(buffer), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `attachment; filename="tarragon-health-report-${report.row.year}${variant === "shared" ? "-shared" : ""}.pdf"`,
      "Cache-Control": "private, no-store",
    },
  });
}
