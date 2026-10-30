"use client";

import { useLabPartnerDashboardStats } from "@/lib/queries/lab-specimens";
import { LoadFailure, StaleDataNotice } from "@/components/ui/load-failure";
import { StatTile } from "@/components/ui/stat-tile";
import { SEMANTIC_ICON, NAV_ICON } from "@/lib/icons";
import { formatNumber } from "@/lib/analytics/format";

/** §56.13 — the dashboard tile row the spec names directly: orders today,
 * samples received, processing, completed, rejected, delayed. */
export function LabPartnerDashboardStatsRow() {
  const { data: stats, isError } = useLabPartnerDashboardStats();

  // Hidden while loading, but a failed read says so: six tiles quietly missing
  // reads the same as a lab with no samples today.
  if (isError && !stats) {
    return (
      <LoadFailure>
        Today&apos;s sample counts could not be loaded just now. They are unknown, not zero. Refresh the page to try
        again.
      </LoadFailure>
    );
  }
  if (!stats) return null;

  return (
    <div className="space-y-3">
      {isError && (
        <StaleDataNotice>
          These counts may be out of date: the last refresh failed. Refresh the page to try again.
        </StaleDataNotice>
      )}
      <div className="grid gap-4 sm:grid-cols-3 lg:grid-cols-6">
        <StatTile icon={SEMANTIC_ICON.logistics} label="Orders today" value={formatNumber(stats.orders_today)} />
        <StatTile icon={NAV_ICON.upload} label="Samples received" value={formatNumber(stats.samples_received_today)} />
        <StatTile icon={SEMANTIC_ICON.labs} label="Processing" value={formatNumber(stats.samples_processing)} />
        <StatTile icon={NAV_ICON.review} label="Completed" value={formatNumber(stats.samples_completed_today)} />
        <StatTile
          icon={SEMANTIC_ICON.logistics}
          tintClassName={stats.samples_rejected_today > 0 ? "bg-amber-100" : undefined}
          iconClassName={stats.samples_rejected_today > 0 ? "text-amber-700" : undefined}
          label="Rejected"
          value={formatNumber(stats.samples_rejected_today)}
        />
        <StatTile
          icon={SEMANTIC_ICON.logistics}
          tintClassName={stats.samples_delayed > 0 ? "bg-red-100" : undefined}
          iconClassName={stats.samples_delayed > 0 ? "text-red-700" : undefined}
          label="Delayed"
          value={formatNumber(stats.samples_delayed)}
        />
      </div>
    </div>
  );
}
