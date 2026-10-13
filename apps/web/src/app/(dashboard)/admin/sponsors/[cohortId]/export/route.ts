import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { getCurrentProfile } from "@/lib/auth/current-profile";
import { createClient } from "@/lib/supabase/server";
import { lagosToday } from "@/lib/format-date";
import { parseSponsorReport, sponsorReportToCsv } from "@/lib/sponsors/report";

export const dynamic = "force-dynamic";

const plainDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine((v) => !Number.isNaN(new Date(`${v}T00:00:00Z`).getTime()));
const input = z.object({ cohortId: z.string().uuid(), from: plainDate.optional(), to: plainDate.optional() });

/**
 * The sponsor report as a file (S38e, Module 22.9). The same aggregate figures as the page. A POST, so a prefetch cannot trigger it; the access
 * is written to the audit log BEFORE the file is built, so a download that cannot be logged is not given.
 */
export async function POST(req: NextRequest, ctx: { params: Promise<{ cohortId: string }> }): Promise<NextResponse> {
  if ((await getCurrentProfile())?.role !== "admin") return new NextResponse("Not allowed", { status: 403 });
  const { cohortId } = await ctx.params;
  const form = await req.formData();
  const raw = (k: string) => {
    const v = form.get(k);
    return typeof v === "string" && v !== "" ? v : undefined;
  };
  const p = input.safeParse({ cohortId, from: raw("from"), to: raw("to") });
  if (!p.success) return new NextResponse("Use plain dates, like 2026-07-01.", { status: 400 });
  const supabase = await createClient();
  const logged = await supabase.rpc("log_sponsor_export", { p_cohort: p.data.cohortId, p_from: p.data.from, p_to: p.data.to });
  if (logged.error) return new NextResponse("The download could not be recorded, so it was not given.", { status: 500 });
  const { data, error } = await supabase.rpc("sponsor_outcome_report", { p_cohort: p.data.cohortId, p_from: p.data.from, p_to: p.data.to });
  const report = error ? null : parseSponsorReport(data);
  if (!report) return new NextResponse("The report could not be read.", { status: 502 });
  return new NextResponse(sponsorReportToCsv(report), {
    status: 200,
    headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": `attachment; filename="tarragon-sponsor-${lagosToday()}.csv"`, "Cache-Control": "no-store" },
  });
}
