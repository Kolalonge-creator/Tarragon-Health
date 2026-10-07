import { redirect } from "next/navigation";
import { getCurrentProfile } from "@/lib/auth/current-profile";
import { createClient } from "@/lib/supabase/server";
import { PageHeader } from "@/components/ui/page-header";
import { RecoveryConsole, type RecoveryRow } from "./recovery-console";

export const metadata = { title: "Assisted account recovery" };

export default async function AccountRecoveryPage() {
  const profile = await getCurrentProfile();
  if (!profile) redirect("/login");
  // Admin only, same as the database (private.is_admin inside every RPC). Delegated permission holders are not admitted:
  // taking over an account is a higher bar than reading a support view.
  if (profile.role !== "admin") redirect("/admin");

  const supabase = await createClient();
  const { data } = await supabase.rpc("list_assisted_recovery_requests", {});
  const rows: RecoveryRow[] = (data ?? []).map((r) => ({
    id: r.id,
    createdAt: r.created_at,
    state: r.state,
    method: r.method,
    simSwapRisk: r.sim_swap_risk,
    simSwapReviewed: r.sim_swap_reviewed,
    requestedBy: r.requested_by,
    expiresAt: r.expires_at,
    reason: r.reason,
    checksDone: r.checks_done,
    subjectName: r.subject_name,
    phoneHint: r.phone_hint,
    emailHint: r.email_hint,
    outcome: r.outcome,
  }));

  return (
    <div className="space-y-6">
      <PageHeader
        title="Assisted account recovery"
        description="Help someone who cannot sign in. Every step is logged. One admin asks, a different admin approves, and the person is told by in-app message and email. You never see or set a password, and the recovery link only ever goes to the email on file."
      />
      <RecoveryConsole rows={rows} currentUserId={profile.id} />
    </div>
  );
}
