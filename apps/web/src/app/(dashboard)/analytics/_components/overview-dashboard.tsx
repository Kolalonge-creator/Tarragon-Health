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
import { buildOverviewSummary } from "@/lib/analytics/overview-summary";
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

  const { banner, tiles } = buildOverviewSummary({
    business,
    financial,
    investor,
    governance,
    facilities,
    outcomes,
  });

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 rounded-2xl bg-gradient-to-br from-clinical-navy to-brand-green p-6 text-white sm:flex-row sm:items-center sm:justify-between sm:p-8">
        <div>
          <h2 className="font-heading text-2xl font-semibold sm:text-3xl">
            Welcome back{firstName ? `, ${firstName}` : ""}
          </h2>
          <p className="mt-1 max-w-xl text-sm text-white/80">{banner}</p>
        </div>
        <Link
          href="/analytics/governance"
          className="inline-flex shrink-0 items-center justify-center rounded-lg bg-white px-5 py-2.5 text-sm font-semibold text-clinical-navy transition-colors hover:bg-white/90"
        >
          View governance
        </Link>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <StatTile icon={CreditCard} label="Total revenue" {...tiles.revenue} />
        <StatTile icon={Users} label="Total patients" {...tiles.patients} />
        <StatTile icon={TrendingUp} label="Revenue (12 months)" {...tiles.revenue12m} />
        <StatTile icon={ShieldCheck} label="Clinician licences verified" {...tiles.verification} />
        <StatTile icon={Building2} label="Facilities with activity" {...tiles.facilities} />
        <StatTile icon={HeartPulse} label="BP control rate" {...tiles.bpControl} />
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
