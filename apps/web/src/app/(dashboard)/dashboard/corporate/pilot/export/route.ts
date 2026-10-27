import type { NextRequest } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { parsePilotReport, pilotReportToCsv } from "@/lib/employer-pilot/model";

export const dynamic = "force-dynamic";

const querySchema = z.object({ pilot: z.string().uuid() });

/**
 * CSV of the aggregate pilot report, for the signed-in employer admin (or finance). It calls the same database function the page calls,
 * on the caller's own session, so the function's authorisation and minimum-cell rules apply unchanged (rule I9): no service role, no
 * second query, no per-person row can reach this file.
 */
export async function GET(req: NextRequest) {
  const parsed = querySchema.safeParse({ pilot: req.nextUrl.searchParams.get("pilot") });
  if (!parsed.success) return new Response("Bad request", { status: 400 });
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("employer_seat_pilot_report", { p_pilot: parsed.data.pilot });
  if (error) {
    const denied = error.message.includes("pilot_report_not_authorised");
    return new Response(denied ? "Not found" : "Could not build the report", { status: denied ? 404 : 500 });
  }
  const report = parsePilotReport(data);
  if (!report) return new Response("Could not build the report", { status: 500 });
  return new Response(pilotReportToCsv(report), {
    headers: {
      "content-type": "text/csv; charset=utf-8",
      "content-disposition": `attachment; filename="membership-seat-pilot-${report.usage_through}.csv"`,
      "cache-control": "no-store",
    },
  });
}
