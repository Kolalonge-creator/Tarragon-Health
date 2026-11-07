import { getCurrentProfile } from "@/lib/auth/current-profile";
import { createClient, getCurrentUser } from "@/lib/supabase/server";
import { DashboardPlaceholder } from "@/components/dashboard-placeholder";
import { ClinicalStaffSetupWarning } from "@/components/clinical/clinical-staff-setup-warning";
import { getCommunityStaffContext } from "@/components/community/staff-rpc";
import { showsCommunityEntry } from "@/components/community/community-nav";
import { canCoordinate, greetingFirstName, isCoveringDoctor } from "@/lib/care-coordinator/access";
import { WorkspaceProvider } from "./_workspace/workspace-context";
import { WorkspaceShell } from "./_workspace/workspace-shell";

/**
 * The care coordination workspace (CC-1..CC-3, 2026-11-07). One workspace for Care Coordinators and for the doctors covering
 * coordination while none is employed: an employed Senior Medical Officer, or the Chief Medical Officer. The database
 * (private.is_coordination_actor) is the real gate on every action; this only decides what is shown.
 *
 * Every degraded state still renders the old placeholder, so a coordinator with no staff record sees why, not a broken page.
 */
export default async function CareCoordinationLayout({ children }: { children: React.ReactNode }) {
  const [profile, user] = await Promise.all([getCurrentProfile(), getCurrentUser()]);
  const greeting = `Welcome${profile?.full_name ? `, ${profile.full_name}` : ""}`;

  let staff: { doctor_tier: string | null; employment_type: string | null; active: boolean | null } | null = null;
  if (user) {
    const supabase = await createClient();
    const { data } = await supabase
      .from("clinical_staff")
      .select("doctor_tier, employment_type, active")
      .eq("profile_id", user.id)
      .eq("active", true)
      .maybeSingle();
    staff = data;
  }

  if (!user || !profile || !staff) {
    return (
      <DashboardPlaceholder greeting={greeting} roleLabel="Care Coordinator" comingUp={[]}>
        <ClinicalStaffSetupWarning roleLabel="Care Coordinator" />
      </DashboardPlaceholder>
    );
  }

  if (!canCoordinate(profile.role, staff)) {
    return (
      <div className="mx-auto max-w-xl rounded-2xl border border-charcoal-ink/10 bg-white p-6 text-sm text-charcoal-ink/80">
        <h1 className="font-heading text-lg font-semibold text-charcoal-ink">Care coordination</h1>
        <p className="mt-2">
          This workspace is for Care Coordinators and for the doctors on Tarragon&rsquo;s own care team who cover coordination: an employed
          Senior Medical Officer or the Chief Medical Officer. Your account is not set up for it. If you think it should be, ask the Chief
          Medical Officer.
        </p>
      </div>
    );
  }

  // A doctor's community desk is under /clinician (proxy.ts sends them there), so only a coordinator gets the link here.
  const showCommunity = profile.role === "care_coordinator" && showsCommunityEntry("care_coordinator", await getCommunityStaffContext());

  return (
    <WorkspaceProvider
      viewer={{ userId: user.id, firstName: greetingFirstName(profile.full_name), covering: isCoveringDoctor(profile.role) }}
    >
      <WorkspaceShell showCommunity={showCommunity}>{children}</WorkspaceShell>
    </WorkspaceProvider>
  );
}
