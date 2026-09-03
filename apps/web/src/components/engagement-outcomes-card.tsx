import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { StatTile } from "@/components/ui/stat-tile";
import { NAV_ICON } from "@/lib/icons";
import type { EngagementOutcomeBucket } from "@/lib/outcomes/engagement-outcome-correlation";

const TIER_LABEL: Record<EngagementOutcomeBucket["tier"], string> = {
  highly_engaged: "Highly engaged",
  moderately_engaged: "Moderately engaged",
  at_risk: "At risk of disengaging",
  disengaged: "Disengaged",
};

// Fixed left-to-right order regardless of which tiers happen to have data —
// reading the trend across tiers is the entire point of this card.
const TIER_ORDER: EngagementOutcomeBucket["tier"][] = [
  "highly_engaged",
  "moderately_engaged",
  "at_risk",
  "disengaged",
];

/**
 * The actual renewal argument for an HMO/employer buyer: does engagement
 * correlate with a real clinical outcome, not just app activity. Renders
 * nothing until at least one tier has an unsuppressed cohort — a single
 * suppressed bucket sitting alone would say nothing.
 */
export function EngagementOutcomesCard({
  buckets,
  entityLabel = "staff",
}: {
  buckets: EngagementOutcomeBucket[] | null;
  /** "staff" (default, corporate) or "member" (HMO) — copy only, same data. */
  entityLabel?: "staff" | "member";
}) {
  if (!buckets || buckets.length === 0) return null;
  const byTier = new Map(buckets.map((b) => [b.tier, b]));
  const visible = TIER_ORDER.map((tier) => byTier.get(tier)).filter(
    (b): b is EngagementOutcomeBucket => Boolean(b)
  );
  if (visible.every((b) => b.suppressed)) return null;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <NAV_ICON.analytics className="h-5 w-5 text-deep-forest dark:text-brand-green-bright" strokeWidth={2} />
          Engagement and BP control
        </CardTitle>
        <CardDescription>
          Whether more engaged {entityLabel === "member" ? "members" : "staff"} actually have
          better blood-pressure control, not just more app activity.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          {visible.map((bucket) =>
            bucket.suppressed ? null : (
              <StatTile
                key={bucket.tier}
                icon={NAV_ICON.analytics}
                label={`${TIER_LABEL[bucket.tier]}: in BP range`}
                value={`${Math.round((bucket.bpInRangeCount / bucket.cohortSize) * 100)}%`}
                unit={`of ${bucket.cohortSize} monitored`}
              />
            )
          )}
        </div>
        <p className="text-xs text-charcoal-ink/50 dark:text-night-ink/55">
          Latest engagement tier vs. latest BP-control assessment, monitored{" "}
          {entityLabel === "member" ? "members" : "staff"} only. Cells under the organisation&apos;s
          minimum cohort size are withheld to protect individual privacy.
        </p>
      </CardContent>
    </Card>
  );
}
