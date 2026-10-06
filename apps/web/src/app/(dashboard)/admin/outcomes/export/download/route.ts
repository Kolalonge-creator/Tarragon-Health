import { NextResponse, type NextRequest } from "next/server";
import { getCurrentProfile } from "@/lib/auth/current-profile";
import { createClient } from "@/lib/supabase/server";
import { dateParam, parseReport } from "@/lib/outcomes/bp-report";
import { reportToCsv } from "@/lib/outcomes/export-csv";

export const dynamic = "force-dynamic";

/**
 * The aggregate pilot report as a file (S38d). The same report as /admin/outcomes, so the same aggregate-only, small-groups-withheld
 * content. The access is written to the audit log BEFORE the file is built, so a download that cannot be logged is not given. The
 * database refuses anyone who is not an admin or the active CMO.
 */
export async function GET(req: NextRequest): Promise<NextResponse> {
  const profile = await getCurrentProfile();
  if (profile?.role !== "admin") return new NextResponse("Not allowed", { status: 403 });
  const from = dateParam(req.nextUrl.searchParams.get("from") ?? undefined);
  const to = dateParam(req.nextUrl.searchParams.get("to") ?? undefined);
  const supabase = await createClient();
  const logged = await supabase.rpc("log_outcome_export", { p_from: from ?? undefined, p_to: to ?? undefined });
  if (logged.error) return new NextResponse("The download could not be recorded, so it was not given.", { status: 500 });
  const { data, error } = await supabase.rpc("bp_control_report", { p_from: from ?? undefined, p_to: to ?? undefined });
  const report = error ? null : parseReport(data);
  if (!report) return new NextResponse("The report could not be read.", { status: 502 });
  const stamp = new Date().toISOString().slice(0, 10);
  return new NextResponse(reportToCsv(report), {
    status: 200,
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="tarragon-bp-control-${stamp}.csv"`,
      "Cache-Control": "no-store",
    },
  });
}
