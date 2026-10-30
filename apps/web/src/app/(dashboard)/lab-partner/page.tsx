import { redirect } from "next/navigation";
import { getCurrentProfile } from "@/lib/auth/current-profile";
import { createClient } from "@/lib/supabase/server";
import { StatTile } from "@/components/ui/stat-tile";
import { SEMANTIC_ICON, NAV_ICON } from "@/lib/icons";
import { LoadFailure } from "@/components/ui/load-failure";
import { buildLabPartnerOverview } from "@/lib/lab-partner/overview-summary";
import { startOfLagosDayUtc } from "@/lib/ai-coach/lagos-day";
import { LabPartnerWorklist } from "./lab-partner-worklist";
import { LabPartnerTurnaroundCard } from "./lab-partner-turnaround-card";
import { LabPartnerFacilities } from "./lab-partner-facilities";
import { LabPartnerServices } from "./lab-partner-services";
import { LabPartnerSpecimenBoard } from "./lab-partner-specimen-board";
import { LabPartnerDashboardStatsRow } from "./lab-partner-dashboard-stats-row";
import { PartnerStaffInviteForm } from "@/components/partner-admin/partner-staff-invite-form";

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
  const todayStart = startOfLagosDayUtc(now);
  const weekStart = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);

  // Same RPC LabPartnerWorklist re-fetches client-side for its own live
  // query — lab_partner_orders is a SECURITY DEFINER RPC scoped to this lab
  // (20260729234509_lab_partner_surface.sql); there's no direct table grant
  // to compute these counts from instead.
  const overview = buildLabPartnerOverview(await supabase.rpc("lab_partner_orders"), todayStart, weekStart);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-heading text-2xl font-semibold text-charcoal-ink">Lab dashboard</h1>
        <p className="text-charcoal-ink/60">
          Fulfil orders routed to your lab and keep your branches up to date.
        </p>
      </div>

      {overview.failed && (
        <LoadFailure>
          Your order counts could not be loaded just now. They are unknown, not zero, so do not read this as nothing
          waiting. The orders list below may still load. Refresh the page to try again.
        </LoadFailure>
      )}

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatTile icon={SEMANTIC_ICON.logistics} label="Orders routed to you" {...overview.tiles.routed} />
        <StatTile
          icon={NAV_ICON.review}
          tintClassName={overview.tiles.awaiting.needsAttention ? "bg-amber-100" : undefined}
          iconClassName={overview.tiles.awaiting.needsAttention ? "text-amber-700" : undefined}
          label="Awaiting your action"
          {...overview.tiles.awaiting.tile}
          delta={overview.tiles.awaiting.delta}
        />
        <StatTile
          icon={SEMANTIC_ICON.labs}
          label="Resulted today"
          {...overview.tiles.resultedToday}
          delta={{ text: "Since midnight, Lagos time", direction: "flat" }}
        />
        <StatTile
          icon={NAV_ICON.upload}
          label="Resulted this week"
          {...overview.tiles.resultedThisWeek}
          delta={{ text: "Last 7 days", direction: "flat" }}
        />
      </div>

      {/* §56.13 — orders today / samples received / processing / completed /
          rejected / delayed. A client component (its own RPC call) rather
          than folded into the server-rendered tiles above: it needs no
          server-side data this page already fetched, and keeping it
          self-contained means it can revalidate independently as specimens
          move through lab_partner_update_specimen_status/reject. */}
      <LabPartnerDashboardStatsRow />
      <LabPartnerTurnaroundCard />
      <LabPartnerSpecimenBoard />
      <LabPartnerWorklist />
      <LabPartnerFacilities />
      <LabPartnerServices />
      {profile.is_partner_admin && <PartnerStaffInviteForm />}
    </div>
  );
}
