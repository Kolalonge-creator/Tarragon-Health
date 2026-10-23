import Link from "next/link";
import { redirect } from "next/navigation";
import { getCurrentProfile } from "@/lib/auth/current-profile";
import { createClient } from "@/lib/supabase/server";
import { PageHeader } from "@/components/ui/page-header";
import { dateParam } from "@/lib/outcomes/bp-report";
import { CascadeReports } from "@/components/outcomes/cascade-reports";

export const metadata = { title: "Cascade of care" };
export const dynamic = "force-dynamic";

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

/**
 * The cascade of care for hypertension and diabetes (WP3): enrolled, screened, diagnosed, on treatment, controlled, in the terms of the WHO HEARTS
 * and DHIS2 cascade. A cascade of Tarragon Members at a point in time, not of a population. Aggregate only, small numbers withheld, no clinician named.
 * The Chief Medical Officer reads the same report at /clinician/outcomes/cascade (a CMO login cannot open /admin/*).
 */
export default async function CascadePage({ searchParams }: { searchParams: SearchParams }) {
  const profile = await getCurrentProfile();
  if (profile?.role !== "admin") redirect("/admin");
  const sp = await searchParams;
  const supabase = await createClient();
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
      <CascadeReports supabase={supabase} from={dateParam(sp.from)} to={dateParam(sp.to)} />
    </div>
  );
}
