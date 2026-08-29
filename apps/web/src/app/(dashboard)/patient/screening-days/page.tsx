import { redirect } from "next/navigation";
import { getCurrentProfile } from "@/lib/auth/current-profile";
import { ScreeningDaysPanel } from "./screening-days-panel";

/**
 * "Bring your church, market association, cooperative, or SME office and get
 * a discounted rate" — the self-serve half of group screening days (see
 * supabase/migrations/20260829164213_group_screening_days.sql). Any patient
 * account, support-only included, can request one; staff confirm the
 * discounted price before anyone pays.
 */
export default async function ScreeningDaysPage() {
  const profile = await getCurrentProfile();
  if (!profile) redirect("/login");
  if (profile.role !== "patient") redirect("/");

  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-heading text-2xl font-semibold text-charcoal-ink">
          Group screening days
        </h1>
        <p className="max-w-2xl text-charcoal-ink/60">
          Bring a group — a church, a market association, a cooperative, an office — and get a
          discounted rate on a health check for everyone. One payer covers the whole group
          upfront; we&apos;ll confirm the price and headcount with you first.
        </p>
      </div>

      <ScreeningDaysPanel />
    </div>
  );
}
