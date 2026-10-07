import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { getCurrentProfile } from "@/lib/auth/current-profile";
import { createClient } from "@/lib/supabase/server";
import { lagosToday } from "@/lib/format-date";
import { parseReport } from "@/lib/outcomes/bp-report";
import { reportToCsv } from "@/lib/outcomes/export-csv";

export const dynamic = "force-dynamic";

const plainDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine((v) => !Number.isNaN(new Date(`${v}T00:00:00Z`).getTime()));
const input = z.object({ from: plainDate.optional(), to: plainDate.optional() });


/**
 * The aggregate pilot report as a file (S38d). The same report as /admin/outcomes, so the same aggregate-only, small-groups-withheld
 * content. It is a POST (a download that writes an audit row must not be something a link prefetch can trigger). The access is written
 * to the audit log BEFORE the file is built, so a download that cannot be logged is not given. The database refuses anyone who is not
 * an admin or the active CMO.
 */
export async function POST(req: NextRequest): Promise<NextResponse> {
  const profile = await getCurrentProfile();
  if (profile?.role !== "admin") return new NextResponse("Not allowed", { status: 403 });
  const form = await req.formData();
  const raw = (k: string) => {
    const v = form.get(k);
    return typeof v === "string" && v !== "" ? v : undefined;
  };
  const parsed = input.safeParse({ from: raw("from"), to: raw("to") });
  if (!parsed.success) return new NextResponse("Use plain dates, like 2026-07-01.", { status: 400 });
  const { from, to } = parsed.data;
  const supabase = await createClient();
  const logged = await supabase.rpc("log_outcome_export", { p_from: from, p_to: to });
  if (logged.error) return new NextResponse("The download could not be recorded, so it was not given.", { status: 500 });
  const { data, error } = await supabase.rpc("bp_control_report", { p_from: from, p_to: to });
  const report = error ? null : parseReport(data);
  if (!report) return new NextResponse("The report could not be read.", { status: 502 });
  return new NextResponse(reportToCsv(report), {
    status: 200,
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="tarragon-bp-control-${lagosToday()}.csv"`,
      "Cache-Control": "no-store",
    },
  });
}
