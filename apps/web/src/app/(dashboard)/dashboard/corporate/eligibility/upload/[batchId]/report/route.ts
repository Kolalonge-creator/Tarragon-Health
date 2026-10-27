import { rpcLoose } from "@/lib/institution/rpc";
import { rosterErrorReportToCsv } from "@/lib/institution/files";

export const dynamic = "force-dynamic";

/** The row-level error report for one staged upload, as a CSV. Read on the caller's own session, so only their organisation's batch can be read. */
export async function GET(_req: Request, ctx: { params: Promise<{ batchId: string }> }) {
  const { batchId } = await ctx.params;
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(batchId)) return new Response("Not found", { status: 404 });
  const { data, error } = await rpcLoose("employer_roster_upload_report", { p_batch: batchId });
  if (error) return new Response(error.message.includes("Not authorised") ? "Not found" : "Could not build the report", { status: error.message.includes("Not authorised") ? 404 : 500 });
  const csv = rosterErrorReportToCsv(data);
  if (!csv) return new Response("Could not build the report", { status: 500 });
  return new Response(csv, { headers: { "content-type": "text/csv; charset=utf-8", "content-disposition": 'attachment; filename="eligibility-upload-errors.csv"', "cache-control": "no-store" } });
}
