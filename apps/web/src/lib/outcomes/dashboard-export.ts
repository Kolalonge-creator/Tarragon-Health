import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getCurrentClinicalStaff, getCurrentProfile } from "@/lib/auth/current-profile";
import { canAssignCases } from "@/lib/clinical/doctor-tier";
import { lagosToday } from "@/lib/format-date";
import { dashboardToCsv } from "./dashboard-csv";
import { parseDashboard } from "./dashboard-report";
import type { DashboardViewer } from "./dashboard-paths";

/**
 * The stored dashboard figures as a file. The same figures as the page: aggregates only, held-back figures written as "withheld". It is a POST
 * (a download that writes an audit row must not be something a link prefetch can trigger). The access is written to the audit log BEFORE the
 * file is built, so a download that cannot be logged is not given. The database refuses anyone who is not a super admin or the active CMO.
 */
export async function exportDashboard(viewer: DashboardViewer): Promise<NextResponse> {
  const allowed = viewer === "admin" ? (await getCurrentProfile())?.role === "admin" : canAssignCases(await getCurrentClinicalStaff());
  if (!allowed) return new NextResponse("Not allowed", { status: 403 });
  const supabase = await createClient();
  const logged = await supabase.rpc("log_outcomes_dashboard_export");
  if (logged.error) return new NextResponse("The download could not be recorded, so it was not given.", { status: 500 });
  const { data, error } = await supabase.rpc("read_outcomes_dashboard", { p_limit: 36 });
  const rows = error ? null : parseDashboard(data);
  if (!rows) return new NextResponse("The figures could not be read.", { status: 502 });
  return new NextResponse(dashboardToCsv(rows), {
    status: 200,
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="tarragon-engagement-and-outcomes-${lagosToday()}.csv"`,
      "Cache-Control": "no-store",
    },
  });
}
