import Link from "next/link";
import { redirect } from "next/navigation";
import { getCurrentProfile } from "@/lib/auth/current-profile";
import { createClient } from "@/lib/supabase/server";
import { PageHeader } from "@/components/ui/page-header";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { dateParam } from "@/lib/outcomes/bp-report";
import { CascadeView } from "./cascade-view";
import { isAwaitingSignature, parseCascadeReport, type CascadeReport } from "@/lib/outcomes/cascade-report";

export const metadata = { title: "Cascade of care" };
export const dynamic = "force-dynamic";

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

/**
 * The cascade of care for hypertension and diabetes (WP3): enrolled, screened, diagnosed, on treatment, controlled, in the terms of the WHO HEARTS
 * and DHIS2 cascade. A cascade of Tarragon Members at a point in time, not of a population. Aggregate only, small numbers withheld, no clinician named.
 */
export default async function CascadePage({ searchParams }: { searchParams: SearchParams }) {
  const profile = await getCurrentProfile();
  if (profile?.role !== "admin") redirect("/admin");
  const sp = await searchParams;
  const from = dateParam(sp.from);
  const to = dateParam(sp.to);
  const supabase = await createClient();
  const args = { p_from: from ?? undefined, p_to: to ?? undefined };
  const [htn, dm] = await Promise.all([
    supabase.rpc("cascade_of_care_report", { p_condition: "hypertension", ...args }),
    supabase.rpc("cascade_of_care_report", { p_condition: "diabetes", ...args }),
  ]);
  const reports: { title: string; report: CascadeReport | null }[] = [
    { title: "Hypertension", report: htn.error ? null : parseCascadeReport(htn.data) },
    { title: "Diabetes", report: dm.error ? null : parseCascadeReport(dm.data) },
  ];
  const awaiting = reports.some((r) => r.report && isAwaitingSignature(r.report));

  return (
    <div className="space-y-6">
      <PageHeader
        title="Cascade of care"
        backTo={{ href: "/admin/outcomes", label: "Outcomes" }}
        description="How many enrolled adult Members have been measured, have a diagnosis on record, are on a recorded medicine and have their condition under control. A cascade of Tarragon Members, not of a population. Small numbers are withheld and no one is listed."
      />
      <nav aria-label="Outcome reports" className="flex flex-wrap gap-3 text-sm">
        <Link href="/admin/outcomes" className="min-h-11 rounded border px-3 py-2">Blood pressure, day 90 and 180</Link>
        <Link href="/admin/outcomes/measures" className="min-h-11 rounded border px-3 py-2">Other measures</Link>
      </nav>
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
    </div>
  );
}
