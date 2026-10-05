"use client";

import { MessageSquareHeart, MousePointerClick, Send, TimerOff } from "lucide-react";
import { StatTile } from "@/components/ui/stat-tile";
import { useReputationReviewConversion } from "@/lib/analytics/queries";
import { formatNumber } from "@/lib/analytics/format";
import { CenterNote, MiniBarList, SectionCard } from "./primitives";
import { ExportButton } from "./export-button";

const CHANNEL_LABEL: Record<string, string> = {
  native_app_store: "Native app-store prompt",
  trustpilot_email: "Trustpilot email",
};

export function ReputationDashboard() {
  const conversion = useReputationReviewConversion();
  const rows = conversion.data ?? [];

  const totalQueued = rows.reduce((sum, r) => sum + r.queued, 0);
  const totalEngaged = rows.reduce((sum, r) => sum + r.engaged, 0);
  const trustpilotClicks = rows.find((r) => r.channel === "trustpilot_email")?.clicked ?? 0;
  const totalSkipped = rows.reduce((sum, r) => sum + r.skipped_rate_limited, 0);

  return (
    <div className="space-y-6">
      <p className="rounded-md bg-soft-sage/50 px-3 py-2 text-xs text-charcoal-ink/70">
        This is a request → engagement funnel, not a review-submitted count: neither the App/Play
        Store native review prompt nor Trustpilot reports back whether a patient actually left a
        review after being asked. &ldquo;Engaged&rdquo; means the native prompt was invoked (email
        was sent for Trustpilot); &ldquo;Clicked&rdquo; only applies to the Trustpilot email link.
      </p>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatTile icon={Send} label="Requests queued" value={formatNumber(totalQueued)} />
        <StatTile icon={MessageSquareHeart} label="Engaged" value={formatNumber(totalEngaged)} />
        <StatTile
          icon={MousePointerClick}
          label="Trustpilot link clicks"
          value={formatNumber(trustpilotClicks)}
        />
        <StatTile
          icon={TimerOff}
          label="Skipped (rate limit)"
          value={formatNumber(totalSkipped)}
        />
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <SectionCard
          title="Requests queued by channel"
          actions={<ExportButton filename="reputation-requests-by-channel" rows={rows} />}
        >
          {conversion.isLoading ? (
            <CenterNote>Loading…</CenterNote>
          ) : rows.length === 0 ? (
            <CenterNote>No review requests yet.</CenterNote>
          ) : (
            <MiniBarList
              items={rows.map((r) => ({
                label: CHANNEL_LABEL[r.channel] ?? r.channel,
                value: r.queued,
              }))}
              emptyLabel="No review requests yet."
              preserveCase
            />
          )}
        </SectionCard>
        <SectionCard
          title="Engaged by channel"
          description="Native prompt invoked, or Trustpilot email sent."
          actions={<ExportButton filename="reputation-engaged-by-channel" rows={rows} />}
        >
          {conversion.isLoading ? (
            <CenterNote>Loading…</CenterNote>
          ) : rows.length === 0 ? (
            <CenterNote>No engagement yet.</CenterNote>
          ) : (
            <MiniBarList
              items={rows.map((r) => ({
                label: CHANNEL_LABEL[r.channel] ?? r.channel,
                value: r.engaged,
                display:
                  r.clicked !== null
                    ? `${formatNumber(r.engaged)} sent · ${formatNumber(r.clicked)} clicked`
                    : `${formatNumber(r.engaged)} shown`,
              }))}
              emptyLabel="No engagement yet."
              preserveCase
            />
          )}
        </SectionCard>
      </div>
    </div>
  );
}
