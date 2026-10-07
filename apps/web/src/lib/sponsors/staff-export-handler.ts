import { NextResponse } from "next/server";
import { z } from "zod";
import { getCurrentProfile } from "@/lib/auth/current-profile";
import { createClient } from "@/lib/supabase/server";
import { lagosToday } from "@/lib/format-date";
import { parseStaffFigures, staffFiguresToCsv } from "./staff-figures";

const SPONSOR_ROLES = ["hmo_admin", "corporate_admin", "ngo_admin"];

/**
 * A sponsor staff member downloads one programme's frozen monthly figures as a file (S38f). A POST, so a prefetch cannot trigger it. The
 * access is written to the audit log BEFORE the file is built, so a download that could not be logged is not given. Another sponsor's
 * programme and a missing one get the same answer.
 */
export async function handleStaffExport(cohortId: string): Promise<NextResponse> {
  if (!SPONSOR_ROLES.includes((await getCurrentProfile())?.role ?? "")) return new NextResponse("Not allowed", { status: 403 });
  if (!z.string().uuid().safeParse(cohortId).success) return new NextResponse("Not found", { status: 404 });
  const supabase = await createClient();
  const logged = await supabase.rpc("log_sponsor_staff_export", { p_cohort: cohortId });
  if (logged.error) return new NextResponse("The download could not be recorded, so it was not given.", { status: 500 });
  if ((logged.data as { ok?: boolean } | null)?.ok !== true) return new NextResponse("Not found", { status: 404 });
  const figs = await supabase.rpc("sponsor_staff_figures", { p_cohort: cohortId });
  const months = figs.error ? null : parseStaffFigures(figs.data);
  if (!months) return new NextResponse("The figures could not be read.", { status: 502 });
  return new NextResponse(staffFiguresToCsv(months), {
    status: 200,
    headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": `attachment; filename="tarragon-programme-figures-${lagosToday()}.csv"`, "Cache-Control": "no-store" },
  });
}
