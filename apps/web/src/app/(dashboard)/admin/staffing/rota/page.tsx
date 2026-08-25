import { redirect } from "next/navigation";
import { getCurrentProfile } from "@/lib/auth/current-profile";
import { getCallerPermissions } from "@/lib/auth/permissions";
import { RotaManager } from "./rota-manager";

/**
 * The on-call rota: who is actually on duty to take a video or voice
 * consult, right now. Video-visit acceptance itself (accept_video_visit_
 * request) still isn't restricted to whoever's on call — that would be
 * unsafe to flip on before any org has actually populated a schedule. This
 * page is the coverage record itself: the concrete artefact an HMO or
 * NAFDAC reviewer, or ops at 2am, can point to instead of "some doctor
 * eventually clicks accept."
 */
export default async function ClinicianRotaPage() {
  const profile = await getCurrentProfile();
  if (!profile) redirect("/login");
  if (!profile.organisation_id) redirect("/admin");

  const { isSuperAdmin, keys } = await getCallerPermissions();
  if (!isSuperAdmin && !keys.has("members.activity.view")) redirect("/admin");

  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-heading text-2xl font-semibold text-charcoal-ink">On-call rota</h1>
        <p className="text-charcoal-ink/60">
          Publish who&apos;s on duty for video and voice consults. Only an org admin or the
          Clinical Director can add or remove a shift.
        </p>
      </div>
      <RotaManager />
    </div>
  );
}
