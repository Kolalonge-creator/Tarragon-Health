import { redirect } from "next/navigation";
import { getCurrentProfile } from "@/lib/auth/current-profile";
import { createClient } from "@/lib/supabase/server";
import { StatTile } from "@/components/ui/stat-tile";
import { SEMANTIC_ICON, NAV_ICON } from "@/lib/icons";
import { formatNumber } from "@/lib/analytics/format";
import { startOfLagosDayUtc } from "@/lib/ai-coach/lagos-day";
import { LabPartnerWorklist } from "./lab-partner-worklist";
import { LabPartnerTurnaroundCard } from "./lab-partner-turnaround-card";
import { LabPartnerFacilities } from "./lab-partner-facilities";
import { LabPartnerServices } from "./lab-partner-services";
import { PartnerStaffInviteForm } from "@/components/partner-admin/partner-staff-invite-form";

type OrderRow = { status: string; resulted_at: string | null };

export default async function LabPartnerPage() {
  const profile = await getCurrentProfile();
  if (!profile) redirect("/login");

  // Partner-lab surface only. Other roles never see patient PHI here — and
  // even if they reached the RPCs, private.lab_partner_provider() returns
  // null for them, so nothing would come back.
  if (profile.role !== "lab_partner") {
    return (
      <div className="mx-auto max-w-3xl p-6">
        <p className="text-sm text-charcoal-ink/70">
          This area is for partner laboratories.
        </p>
      </div>
    );
  }

  const supabase = await createClient();
  const now = new Date();
  const todayStartIso = startOfLagosDayUtc(now).toISOString();
  const weekStartIso = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000).toISOString();

  // Same RPC LabPartnerWorklist re-fetches client-side for its own live
  // query — lab_partner_orders is a SECURITY DEFINER RPC scoped to this lab
  // (20260729234509_lab_partner_surface.sql); there's no direct table grant
  // to compute these counts from instead.
  const { data: orderRows } = await supabase.rpc("lab_partner_orders");
  const orders = (orderRows ?? []) as OrderRow[];

  const awaitingActionCount = orders.filter(
    (o) => o.status !== "resulted" && o.status !== "cancelled",
  ).length;
  const resultedTodayCount = orders.filter(
    (o) => o.resulted_at != null && o.resulted_at >= todayStartIso,
  ).length;
  const resultedThisWeekCount = orders.filter(
    (o) => o.resulted_at != null && o.resulted_at >= weekStartIso,
  ).length;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-heading text-2xl font-semibold text-charcoal-ink">Lab dashboard</h1>
        <p className="text-charcoal-ink/60">
          Fulfil orders routed to your lab and keep your branches up to date.
        </p>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatTile
          icon={SEMANTIC_ICON.logistics}
          label="Orders routed to you"
          value={formatNumber(orders.length)}
        />
        <StatTile
          icon={NAV_ICON.review}
          tintClassName={awaitingActionCount > 0 ? "bg-amber-100" : undefined}
          iconClassName={awaitingActionCount > 0 ? "text-amber-700" : undefined}
          label="Awaiting your action"
          value={formatNumber(awaitingActionCount)}
          delta={{
            text: awaitingActionCount > 0 ? "Needs a result uploaded" : "All caught up",
            direction: awaitingActionCount > 0 ? "down" : "up",
          }}
        />
        <StatTile
          icon={SEMANTIC_ICON.labs}
          label="Resulted today"
          value={formatNumber(resultedTodayCount)}
          delta={{ text: "Since midnight, Lagos time", direction: "flat" }}
        />
        <StatTile
          icon={NAV_ICON.upload}
          label="Resulted this week"
          value={formatNumber(resultedThisWeekCount)}
          delta={{ text: "Last 7 days", direction: "flat" }}
        />
      </div>

      <LabPartnerTurnaroundCard />
      <LabPartnerWorklist />
      <LabPartnerFacilities />
      <LabPartnerServices />
      {profile.is_partner_admin && <PartnerStaffInviteForm />}
    </div>
  );
}
