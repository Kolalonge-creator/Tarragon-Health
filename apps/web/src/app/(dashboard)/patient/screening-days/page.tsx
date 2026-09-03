import { redirect } from "next/navigation";
import { getCurrentProfile } from "@/lib/auth/current-profile";
import { PageHeader } from "@/components/ui/page-header";
import { SEMANTIC_ICON } from "@/lib/icons";
import { ScreeningDaysPanel } from "./screening-days-panel";

/**
 * "Bring your church, market association, cooperative, or SME office and get
 * a discounted rate" — the self-serve half of group screening days (see
 * supabase/migrations/20260829003735_group_screening_days.sql). Any patient
 * account, support-only included, can request one; staff confirm the
 * discounted price before anyone pays.
 */
export default async function ScreeningDaysPage() {
  const profile = await getCurrentProfile();
  if (!profile) redirect("/login");
  if (profile.role !== "patient") redirect("/");

  return (
    <div className="space-y-6">
      <PageHeader
        title="Group screening days"
        icon={SEMANTIC_ICON.preventive}
        description="Bring a group (a church, a market association, a cooperative, an office) and get a discounted rate on a health check for everyone. One payer covers the whole group upfront; we'll confirm the price and headcount with you first."
      />

      <ScreeningDaysPanel />
    </div>
  );
}
