"use client";

import Link from "next/link";
import { Building2, CreditCard, HeartPulse, ShieldCheck, TrendingUp, Users } from "lucide-react";
import { StatTile } from "@/components/ui/stat-tile";
import { Card } from "@/components/ui/card";
import {
  useBusinessSummary,
  useClinicalOutcomes,
  useFacilityEngagement,
  useFinancialSummary,
  useGovernanceSummary,
  useInvestorSummary,
} from "@/lib/analytics/queries";
import { buildOverviewSummary, TILE_LABELS } from "@/lib/analytics/overview-summary";
import { fromQueryResult } from "@/lib/queries/query-slice";
import { StaleDataNotice } from "@/components/ui/load-failure";
import { standoutView } from "@/lib/analytics/standout";
import { StandoutHero } from "./standout-hero";
import { ANALYTICS_GROUP_ORDER, ANALYTICS_SECTIONS } from "@/lib/analytics/sections";

/**
 * Render layer only. What each tile and the banner say, including what they
 * say while a figure is loading, failed or was refused, is decided in
 * lib/analytics/overview-summary.ts, where it is tested. Do not default a
 * missing figure to zero in here: an unknown figure must never read as zero.
 */
export function OverviewDashboard({ firstName }: { firstName: string | null }) {
  const business = useBusinessSummary();
  const financial = useFinancialSummary();
  const investor = useInvestorSummary();
  const governance = useGovernanceSummary();
  const facilities = useFacilityEngagement();
  const outcomes = useClinicalOutcomes();

  const inputs = {
    business: fromQueryResult(business),
    financial: fromQueryResult(financial),
    investor: fromQueryResult(investor),
    governance: fromQueryResult(governance),
    facilities: fromQueryResult(facilities),
    outcomes: fromQueryResult(outcomes),
  };
  const { banner, tiles, staleNotice } = buildOverviewSummary(inputs);
  const standout = standoutView(inputs);

  return (
    <div className="space-y-6">
      <div>
        <h2 className="font-heading text-2xl font-semibold text-charcoal-ink">
          Welcome back{firstName ? `, ${firstName}` : ""}
        </h2>
        <p className="mt-1 max-w-2xl text-sm text-charcoal-ink/70">{banner}</p>
      </div>

      {staleNotice && <StaleDataNotice>{staleNotice}</StaleDataNotice>}

      <StandoutHero view={standout} />

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <StatTile icon={CreditCard} label={TILE_LABELS.revenue} {...tiles.revenue} />
        <StatTile icon={Users} label={TILE_LABELS.patients} {...tiles.patients} />
        <StatTile icon={TrendingUp} label={TILE_LABELS.revenue12m} {...tiles.revenue12m} />
        <StatTile icon={ShieldCheck} label={TILE_LABELS.verification} {...tiles.verification} />
        <StatTile icon={Building2} label={TILE_LABELS.facilities} {...tiles.facilities} />
        <StatTile icon={HeartPulse} label={TILE_LABELS.bpControl} {...tiles.bpControl} />
      </div>

      {ANALYTICS_GROUP_ORDER.map((group) => (
        <Card key={group} className="p-5">
          <h3 className="mb-3 font-heading text-base font-semibold text-charcoal-ink">{group}</h3>
          <div className="flex flex-wrap gap-2.5">
            {ANALYTICS_SECTIONS.filter((s) => s.group === group).map((s) => (
              <Link
                key={s.href}
                href={s.href}
                title={s.subtitle}
                className="rounded-lg border border-charcoal-ink/12 bg-warm-ivory px-3.5 py-2 text-sm font-semibold text-charcoal-ink transition-colors hover:border-brand-green/40 hover:bg-soft-sage/50"
              >
                {s.label}
              </Link>
            ))}
          </div>
        </Card>
      ))}
    </div>
  );
}
