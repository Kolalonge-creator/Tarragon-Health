"use client";

import Link from "next/link";
import {
  Activity,
  AlertTriangle,
  Building2,
  CreditCard,
  Percent,
  ScrollText,
  TrendingUp,
  Users,
} from "lucide-react";
import { StatTile } from "@/components/ui/stat-tile";
import {
  useAuditSummary,
  useBusinessSummary,
  useFinancialSummary,
  usePopulationSummary,
} from "@/lib/analytics/queries";
import { formatMinor, formatNumber, formatPercent } from "@/lib/analytics/format";
import { SectionCard } from "./primitives";

export function OverviewDashboard() {
  const business = useBusinessSummary();
  const financial = useFinancialSummary();
  const population = usePopulationSummary();
  const audit = useAuditSummary();

  const ngnMrr = financial.data?.mrr_by_currency.find((m) => m.currency === "NGN")?.mrr_minor ?? 0;
  const careGapTotal = (population.data?.care_gaps ?? []).reduce((sum, g) => sum + g.count, 0);

  return (
    <div className="space-y-6">
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatTile icon={Building2} label="Organisations" value={formatNumber(business.data?.total_orgs ?? 0)} />
        <StatTile icon={Users} label="Patients" value={formatNumber(business.data?.total_patients ?? 0)} />
        <StatTile icon={TrendingUp} label="MRR (NGN)" value={formatMinor(ngnMrr, "NGN")} />
        <StatTile
          icon={CreditCard}
          label="Active subscriptions"
          value={formatNumber(financial.data?.active_subscriptions ?? 0)}
        />
        <StatTile icon={Percent} label="Churn rate" value={formatPercent(financial.data?.churn_rate ?? 0)} />
        <StatTile
          icon={AlertTriangle}
          label="Abnormal screening rate"
          value={formatPercent(population.data?.abnormal_screening_rate ?? 0)}
        />
        <StatTile icon={Activity} label="Open care gaps" value={formatNumber(careGapTotal)} />
        <StatTile icon={ScrollText} label="Audit events" value={formatNumber(audit.data?.total ?? 0)} />
      </div>

      <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-4">
        {[
          { href: "/analytics/acquisition", title: "Acquisition", copy: "Visitors, geography, referrers, funnel." },
          { href: "/analytics/engagement", title: "Engagement", copy: "DAU/WAU/MAU, adoption, retention." },
          { href: "/analytics/users", title: "Users", copy: "Active/dormant, by plan, condition, state." },
          { href: "/analytics/business", title: "Business", copy: "Growth, accounts, geography." },
          { href: "/analytics/financial", title: "Financial", copy: "MRR, revenue, commissions, churn." },
          { href: "/analytics/investor", title: "Investor", copy: "NRR/GRR, LTV/CAC, Rule of 40, runway." },
          { href: "/analytics/accounting", title: "Accounting", copy: "Rev-rec, deferred, AR aging, reconciliation." },
          { href: "/analytics/doctors", title: "Doctor performance", copy: "Panels, throughput, response speed." },
          { href: "/analytics/team", title: "Team activity", copy: "Staff logins, sessions, time on platform." },
          { href: "/analytics/governance", title: "Governance", copy: "Credentials, consent, risk register." },
          {
            href: "/analytics/population",
            title: "Population health",
            copy: "Conditions, risk, screening, care gaps.",
          },
          { href: "/analytics/outcomes", title: "Clinical outcomes", copy: "Control rates, risk migration, SLA." },
          { href: "/analytics/operations", title: "Operations", copy: "Workload, queues, deliverability." },
          { href: "/analytics/facilities", title: "Facilities", copy: "Engagement, users per facility." },
          { href: "/analytics/audit", title: "Audit log", copy: "Every platform event, filterable." },
        ].map((c) => (
          <Link key={c.href} href={c.href} className="block">
            <SectionCard title={c.title} className="h-full transition-shadow hover:shadow-md">
              <p className="text-sm text-charcoal-ink/60">{c.copy}</p>
              <span className="mt-3 inline-block text-sm font-medium text-brand-green">Open →</span>
            </SectionCard>
          </Link>
        ))}
      </div>
    </div>
  );
}
