import { redirect } from "next/navigation";
import { getCurrentProfile } from "@/lib/auth/current-profile";
import { PageHeader } from "@/components/ui/page-header";
import { ApplicantFlow, StartApplication } from "@/components/credentialing/applicant-flow";
import { CredentialStatus } from "@/components/credentialing/credential-status";
import { Flash } from "@/components/credentialing/shared";
import { getMyApplication, getMyCredentialStatus } from "@/lib/credentialing/queries";
import { firstParam, type SearchParams } from "@/lib/credentialing/params";

export const metadata = { title: "Join as a clinician" };
export const dynamic = "force-dynamic";

const IN_PROGRESS = ["started", "documents_submitted", "checks_in_progress", "training", "test_passed", "approved_tier1"];

/**
 * The applicant's page, and the renewal page for a clinician whose access is paused. It sits under /account so
 * any signed-in person can reach it: an applicant is a plain account until they are activated, never a clinician
 * early. The database decides what each person may do here.
 */
export default async function ClinicianApplicationPage({ searchParams }: { searchParams: SearchParams }) {
  const profile = await getCurrentProfile();
  if (!profile) redirect("/login");
  const sp = await searchParams;

  const [app, status] = await Promise.all([getMyApplication(), getMyCredentialStatus()]);
  const inProgress = app !== null && IN_PROGRESS.includes(app.state);

  return (
    <div className="mx-auto max-w-3xl space-y-5">
      <PageHeader title="Join as a clinician" description="Apply to work with Tarragon Health's care team, or renew your documents." />
      <Flash ok={firstParam(sp.ok)} error={firstParam(sp.error)} />
      {inProgress && app ? <ApplicantFlow app={app} /> : null}
      {!inProgress && status ? <CredentialStatus status={status} returnTo="/account/clinician" now={new Date()} /> : null}
      {!inProgress && !status && app ? <ApplicantFlow app={app} /> : null}
      {!inProgress && !status && (!app || app.state === "rejected") ? <StartApplication canApply={profile.role === "patient"} /> : null}
    </div>
  );
}
