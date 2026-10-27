import { redirect } from "next/navigation";
import { getCurrentClinicalStaff } from "@/lib/auth/current-profile";
import { canAssignCases } from "@/lib/clinical/doctor-tier";
import { createClient } from "@/lib/supabase/server";
import { PageHeader } from "@/components/ui/page-header";
import { dateParam } from "@/lib/outcomes/bp-report";
import { CascadeReports } from "@/components/outcomes/cascade-reports";

export const metadata = { title: "Cascade of care" };
export const dynamic = "force-dynamic";

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

/**
 * The Chief Medical Officer's own read of the cascade of care (WP3). The same report and the same component as /admin/outcomes/cascade: a CMO
 * account is the unified `clinician` role and can never open /admin/*, so canAssignCases (chief_medical_officer only) is the gate here, the same
 * pattern as /clinician/team-caseload. The database refuses everyone but an admin and the active CMO as well. Read only.
 */
export default async function ClinicianCascadePage({ searchParams }: { searchParams: SearchParams }) {
  if (!canAssignCases(await getCurrentClinicalStaff())) redirect("/clinician");
  const sp = await searchParams;
  const supabase = await createClient();
  return (
    <div className="space-y-6">
      <PageHeader
        title="Cascade of care"
        backTo={{ href: "/clinician", label: "Clinician home" }}
        description="How many enrolled adult Members have been measured, have a diagnosis on record, are on a recorded medicine and have their condition under control. A cascade of Tarragon Members, not of a population. Small numbers are withheld and no one is listed."
      />
      <CascadeReports supabase={supabase} from={dateParam(sp.from)} to={dateParam(sp.to)} />
    </div>
  );
}
