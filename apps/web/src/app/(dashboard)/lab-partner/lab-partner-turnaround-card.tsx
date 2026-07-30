"use client";

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { useLabPartnerTurnaroundStats } from "@/lib/queries/lab-partner";

/**
 * Turns the platform's own SLA-transparency discipline outward on a partner
 * relationship: a lab can see the same turnaround numbers Tarragon can, not
 * be measured silently from the other side of the fence.
 */
export function LabPartnerTurnaroundCard() {
  const { data: stats, isLoading } = useLabPartnerTurnaroundStats();

  return (
    <Card>
      <CardHeader>
        <CardTitle>Your turnaround time (last 90 days)</CardTitle>
        <CardDescription>
          Time from a patient&apos;s payment being confirmed to your result being uploaded.
        </CardDescription>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <p className="text-sm text-charcoal-ink/60">Loading…</p>
        ) : !stats || stats.orders_resulted === 0 ? (
          <p className="text-sm text-charcoal-ink/60">No resulted orders in this window yet.</p>
        ) : (
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <div>
              <p className="text-xs text-charcoal-ink/50">Orders resulted</p>
              <p className="text-lg font-semibold text-charcoal-ink">{stats.orders_resulted}</p>
            </div>
            <div>
              <p className="text-xs text-charcoal-ink/50">Average</p>
              <p className="text-lg font-semibold text-charcoal-ink">{stats.avg_turnaround_hours}h</p>
            </div>
            <div>
              <p className="text-xs text-charcoal-ink/50">Median</p>
              <p className="text-lg font-semibold text-charcoal-ink">{stats.median_turnaround_hours}h</p>
            </div>
            <div>
              <p className="text-xs text-charcoal-ink/50">Over 72h</p>
              <p className="text-lg font-semibold text-charcoal-ink">{stats.pct_over_72h}%</p>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
