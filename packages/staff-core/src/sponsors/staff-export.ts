import { parseStaffFigures, staffFiguresToCsv } from "./staff-figures";

/** The RPC surface the export needs. Injected so it runs the same on web and console, and is testable without mocking modules. */
export type StaffRpc = (fn: "log_sponsor_staff_export" | "sponsor_staff_figures", args: { p_cohort: string }) => PromiseLike<{ data: unknown; error: unknown }>;

export const SPONSOR_STAFF_ROLES = ["hmo_admin", "corporate_admin", "ngo_admin"] as const;
/** Today in Lagos as YYYY-MM-DD. */
function lagosToday(now: Date): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Africa/Lagos", year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
}
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * A sponsor staff member downloads one programme's frozen monthly figures as a file (S38f). Only sponsor staff may ask; the access is
 * written to the audit log BEFORE the file is built, so a download that could not be logged is not given; another sponsor's programme and a
 * missing one get the same answer. The caller supplies the role and the RPC; the file is dated in Lagos.
 */
export async function staffExportResponse(input: { role: string | null | undefined; cohortId: string; rpc: StaffRpc; now?: Date }): Promise<Response> {
  if (!(SPONSOR_STAFF_ROLES as readonly string[]).includes(input.role ?? "")) return new Response("Not allowed", { status: 403 });
  if (!UUID.test(input.cohortId)) return new Response("Not found", { status: 404 });
  const logged = await input.rpc("log_sponsor_staff_export", { p_cohort: input.cohortId });
  if (logged.error) return new Response("The download could not be recorded, so it was not given.", { status: 500 });
  if ((logged.data as { ok?: boolean } | null)?.ok !== true) return new Response("Not found", { status: 404 });
  const figs = await input.rpc("sponsor_staff_figures", { p_cohort: input.cohortId });
  const months = figs.error ? null : parseStaffFigures(figs.data);
  if (!months) return new Response("The figures could not be read.", { status: 502 });
  return new Response(staffFiguresToCsv(months), {
    status: 200,
    headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": `attachment; filename="tarragon-programme-figures-${lagosToday(input.now ?? new Date())}.csv"`, "Cache-Control": "no-store" },
  });
}
