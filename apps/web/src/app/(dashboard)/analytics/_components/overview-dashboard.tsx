"use client";

import Link from "next/link";
import { NAV_ICON, SEMANTIC_ICON } from "@/lib/icons";
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
import { formatMinor, formatNumber, formatPercent } from "@/lib/analytics/format";
import { ANALYTICS_GROUP_ORDER, ANALYTICS_SECTIONS } from "@/lib/analytics/sections";

export function OverviewDashboard({ firstName }: { firstName: string | null }) {
  const business = useBusinessSummary();
  const financial = useFinancialSummary();
  const investor = useInvestorSummary();
  const governance = useGovernanceSummary();
  const facilities = useFacilityEngagement();
  const outcomes = useClinicalOutcomes();

  const ngnRevenue =
    financial.data?.revenue_by_currency.find((r) => r.currency === "NGN")?.total_minor ??
    financial.data?.revenue_by_currency[0]?.total_minor ??
    0;
  const momGrowth = investor.data?.mom_growth_pct;
  const verificationPct = governance.data?.clinical?.verification_pct ?? 0;
  const openRisk = governance.data?.risk?.open ?? 0;
  const totalFacilities = facilities.data?.total_facilities ?? 0;
  const facilitiesWithUsage = facilities.data?.facilities_with_usage ?? 0;
  const utilizationPct = totalFacilities > 0 ? (facilitiesWithUsage / totalFacilities) * 100 : 0;
  const bpControlled = outcomes.data?.bp_control.controlled ?? 0;
  const bpTotal = outcomes.data?.bp_control.total ?? 0;
  const bpPct = outcomes.data?.bp_control.pct ?? 0;

  const bannerParts: string[] = [];
  if (momGrowth !== undefined && momGrowth !== 0) {
    bannerParts.push(
      `MRR is ${momGrowth >= 0 ? "up" : "down"} ${formatPercent(Math.abs(momGrowth))} month over month`
    );
  }
  bannerParts.push(`${formatNumber(business.data?.total_patients ?? 0)} patients on the platform`);
  if (governance.data) {
    bannerParts.push(`staff verification is holding at ${formatPercent(verificationPct)}`);
  }
  const bannerCopy =
    bannerParts.join(", ") +
    (openRisk > 0
      ? ` — ${formatNumber(openRisk)} open risk item${openRisk === 1 ? "" : "s"} still need review.`
      : ".");

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 rounded-2xl bg-gradient-to-br from-clinical-navy to-brand-green p-6 text-white sm:flex-row sm:items-center sm:justify-between sm:p-8">
        <div>
          <h2 className="font-heading text-2xl font-semibold sm:text-3xl">
            Welcome back{firstName ? `, ${firstName}` : ""}
          </h2>
          <p className="mt-1 max-w-xl text-sm text-white/80">{bannerCopy}</p>
        </div>
        <Link
          href="/analytics/governance"
          className="inline-flex shrink-0 items-center justify-center rounded-lg bg-white px-5 py-2.5 text-sm font-semibold text-clinical-navy transition-colors hover:bg-white/90"
        >
          View governance
        </Link>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <StatTile
          icon={SEMANTIC_ICON.billing}
          label="Total revenue"
          value={formatMinor(ngnRevenue, "NGN")}
          delta={{
            text: `${formatMinor(financial.data?.receivables_kobo ?? 0, "NGN")} receivable`,
            direction: "flat",
          }}
        />
        <StatTile
          icon={NAV_ICON.headcount}
          label="Total patients"
          value={formatNumber(business.data?.total_patients ?? 0)}
          delta={{ text: `${formatNumber(business.data?.active_patients ?? 0)} active`, direction: "flat" }}
        />
        <StatTile
          icon={NAV_ICON.growth}
          label="ARR"
          value={formatMinor(investor.data?.arr_minor ?? 0, "NGN")}
          delta={
            momGrowth !== undefined
              ? { text: `${formatPercent(Math.abs(momGrowth))} MoM`, direction: momGrowth >= 0 ? "up" : "down" }
              : undefined
          }
        />
        <StatTile
          icon={SEMANTIC_ICON.slaCompliance}
          label="Compliance score"
          value={formatPercent(verificationPct)}
          delta={{
            text: openRisk > 0 ? `${formatNumber(openRisk)} open risk items` : "No open risk items",
            direction: openRisk > 0 ? "down" : "up",
          }}
        />
        <StatTile
          icon={SEMANTIC_ICON.corporate}
          label="Avg facility utilization"
          value={formatPercent(utilizationPct)}
          delta={{ text: `${formatNumber(facilitiesWithUsage)} of ${formatNumber(totalFacilities)} active`, direction: "flat" }}
        />
        <StatTile
          icon={SEMANTIC_ICON.bp}
          label="BP control rate"
          value={formatPercent(bpPct)}
          delta={bpTotal > 0 ? { text: `${formatNumber(bpControlled)} of ${formatNumber(bpTotal)} controlled`, direction: "flat" } : undefined}
        />
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
