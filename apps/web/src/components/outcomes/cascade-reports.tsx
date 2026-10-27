import type { SupabaseClient } from "@supabase/supabase-js";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { CascadeView } from "@/components/outcomes/cascade-view";
import { isWithheldReport, parseCascadeReport, type CascadeReport } from "@/lib/outcomes/cascade-report";

/**
 * The body of the cascade-of-care page, shared by the admin page and the Chief Medical Officer's own page (a CMO account is `clinician` and cannot
 * open /admin/*). The caller has already checked who is asking; the database refuses everyone but an admin and the active CMO as well.
 */
export async function CascadeReports({ supabase, from, to }: { supabase: SupabaseClient; from: string | null; to: string | null }) {
  const args = { p_from: from ?? undefined, p_to: to ?? undefined };
  const [htn, dm] = await Promise.all([
    supabase.rpc("cascade_of_care_report", { p_condition: "hypertension", ...args }),
    supabase.rpc("cascade_of_care_report", { p_condition: "diabetes", ...args }),
  ]);
  const reports: { title: string; report: CascadeReport | null }[] = [
    { title: "Hypertension", report: htn.error ? null : parseCascadeReport(htn.data) },
    { title: "Diabetes", report: dm.error ? null : parseCascadeReport(dm.data) },
  ];
  const awaiting = reports.some((r) => r.report && isWithheldReport(r.report) && r.report.reason === "awaiting_cmo_signature");
  return (
    <>
      <p className="text-sm">Ranges are by whole calendar month of joining, so a figure cannot be narrowed to a few people.</p>
      <form method="get" className="flex flex-wrap items-end gap-3">
        <label className="space-y-1">
          <span className="block text-sm">Joined from</span>
          <input type="date" name="from" defaultValue={from ?? ""} className="min-h-11 rounded border px-2" />
        </label>
        <label className="space-y-1">
          <span className="block text-sm">Joined to</span>
          <input type="date" name="to" defaultValue={to ?? ""} className="min-h-11 rounded border px-2" />
        </label>
        <button type="submit" className="min-h-11 rounded border px-4">Show</button>
      </form>
      {awaiting ? (
        <Card>
          <CardHeader><CardTitle>Not switched on yet</CardTitle></CardHeader>
          <CardContent>
            <p>The Chief Medical Officer has to review and sign the stage definitions on the sign-off page before any figure is shown. Until then nothing is counted on screen, in a file or in a sponsor pack.</p>
          </CardContent>
        </Card>
      ) : (
        reports.map((r) => <CascadeView key={r.title} title={r.title} report={r.report} />)
      )}
    </>
  );
}
