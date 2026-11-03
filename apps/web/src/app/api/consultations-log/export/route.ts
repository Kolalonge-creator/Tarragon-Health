import { NextResponse, type NextRequest } from "next/server";
import { getCurrentClinicalStaff, getCurrentProfile } from "@/lib/auth/current-profile";
import { canAssignCases } from "@/lib/clinical/doctor-tier";
import { createClient } from "@/lib/supabase/server";
import { lagosToday } from "@/lib/format-date";
import { consultationsLogCsv, filtersToRpcArgs, parseConsultationsLogFilters } from "@/lib/consultations/consultations-log";
import { loadConsultationsLog } from "@/lib/consultations/load-consultations-log";

export const dynamic = "force-dynamic";

/**
 * The consultations log as a CSV, with the same filters as the page. An admin or the CMO only; the database refuses anyone
 * else as well (public.consultations_log returns zero rows, log_consultations_log_export raises). Every download writes an
 * audit row first (founder direction: every staff access to record data is audited).
 */
export async function GET(req: NextRequest): Promise<NextResponse> {
  const profile = await getCurrentProfile();
  if (!profile) return new NextResponse("Not signed in", { status: 401 });
  if (profile.role !== "admin" && !canAssignCases(await getCurrentClinicalStaff())) {
    return new NextResponse("Not allowed", { status: 403 });
  }
  const filters = parseConsultationsLogFilters(Object.fromEntries(req.nextUrl.searchParams));
  const supabase = await createClient();
  const rows = await loadConsultationsLog(supabase, filters);
  if (rows === null) return new NextResponse("The consultations log could not be read.", { status: 502 });
  // The download is recorded before the file is given; a download that cannot be recorded is not given.
  const logged = await supabase.rpc("log_consultations_log_export", { ...filtersToRpcArgs(filters), p_rows: rows.length });
  if (logged.error) return new NextResponse("The download could not be recorded, so it was not given.", { status: 500 });
  return new NextResponse(consultationsLogCsv(rows), {
    status: 200,
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="tarragon-consultations-${lagosToday()}.csv"`,
      "Cache-Control": "no-store",
    },
  });
}
