import { redirect } from "next/navigation";
import { getCurrentProfile } from "@/lib/auth/current-profile";
import { hasAnyPermission } from "@/lib/auth/permissions";
import { HandoffList } from "@/components/support-desk/handoff-list";

export const metadata = { title: "Support hand-offs to your team" };
export const dynamic = "force-dynamic";

/**
 * The receiving side of support hand-offs (SUP-2): Finance (finance.view or the finance role), Technical Operations
 * (incidents.manage), Provider Operations (partners.labs.manage, partners.facilities.manage, orgs.manage), Membership
 * Operations (subscriptions.manage) and the super admin. private.can_receive_support_handoff enforces the same mapping.
 */
export default async function ReceivingHandoffsPage() {
  const profile = await getCurrentProfile();
  if (!profile) redirect("/login");
  const allowed =
    profile.role === "finance" ||
    (await hasAnyPermission("finance.view", "incidents.manage", "partners.labs.manage", "partners.facilities.manage", "orgs.manage", "subscriptions.manage"));
  if (!allowed) redirect("/admin");
  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-heading text-2xl font-semibold text-charcoal-ink dark:text-night-ink">Support hand-offs</h1>
        <p className="text-sm text-charcoal-ink/60 dark:text-night-ink/60">
          Questions the support desk needs your team to decide. You see the reason support wrote, not the customer conversation.
        </p>
      </div>
      <HandoffList mode="receiving" me={profile.id} />
    </div>
  );
}
