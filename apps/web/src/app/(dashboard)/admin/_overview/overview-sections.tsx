import Link from "next/link";
import type { LucideIcon } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { StatTile } from "@/components/ui/stat-tile";
import { SEMANTIC_ICON, NAV_ICON } from "@/lib/icons";
import { formatMinor, formatNumber } from "@/lib/analytics/format";
import {
  HEALTH_LABEL,
  MEMBERSHIP_SOURCES,
  PERIOD_KEYS,
  PERIOD_LABEL,
  SOURCE_LABEL,
  compare,
  type HealthLine,
  type HealthState,
  type Overview,
  type PeriodKey,
  type ResolvedPeriod,
} from "@/lib/admin-overview/model";

/**
 * The superadmin homepage's sections (docs/design/SUPERADMIN-CONSOLE.md, phase 2b). Server components; every figure
 * comes from public.analytics_platform_overview or the live dependency checks, and a figure that did not load is
 * never drawn as a zero.
 */

const naira = (kobo: number) => formatMinor(kobo, "NGN");
const lagosTime = (d: Date) =>
  d.toLocaleString("en-GB", { timeZone: "Africa/Lagos", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });

export function PeriodPicker({ current }: { current: PeriodKey }) {
  return (
    <nav aria-label="Reporting period" className="flex flex-wrap gap-1.5">
      {PERIOD_KEYS.map((key) => (
        <Link
          key={key}
          href={`/admin?period=${key}`}
          aria-current={key === current ? "true" : undefined}
          className={
            key === current
              ? "rounded-full bg-brand-green px-3 py-1 text-sm font-medium text-white"
              : "rounded-full border border-charcoal-ink/15 bg-white px-3 py-1 text-sm text-charcoal-ink/75 hover:border-brand-green/50 hover:text-charcoal-ink"
          }
        >
          {PERIOD_LABEL[key]}
        </Link>
      ))}
    </nav>
  );
}

export function OverviewHeader({ firstName, period, loadedAt }: { firstName: string | null; period: ResolvedPeriod; loadedAt: Date }) {
  return (
    <div className="space-y-4 border-b border-charcoal-ink/10 pb-5">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h1 className="font-heading text-2xl font-semibold tracking-tight text-charcoal-ink sm:text-3xl">Platform administration</h1>
          <p className="mt-1 max-w-2xl text-sm text-charcoal-ink/65">
            {firstName ? `Welcome back, ${firstName}. ` : ""}Users, organisations, Memberships, money and system health across Tarragon
            Health, with what needs you first.
          </p>
        </div>
        <p className="shrink-0 text-xs text-charcoal-ink/55">
          Updated {lagosTime(loadedAt)} (Lagos) ·{" "}
          <Link href={`/admin?period=${period.key}`} className="font-medium text-brand-green hover:underline">
            Refresh
          </Link>
        </p>
      </div>
      <PeriodPicker current={period.key} />
    </div>
  );
}

interface Kpi {
  label: string;
  icon: LucideIcon;
  value: string;
  delta: { text: string; direction: "up" | "down" | "flat" };
  href: string;
}

function KpiTile({ kpi }: { kpi: Kpi }) {
  return (
    <Link
      href={kpi.href}
      className="block rounded-xl transition-shadow hover:shadow-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-green"
    >
      <StatTile icon={kpi.icon} label={kpi.label} value={kpi.value} delta={kpi.delta} />
    </Link>
  );
}

/** The period's key figures, each against the window of the same length just before it. */
export function OverviewKpis({ overview, period }: { overview: Overview; period: ResolvedPeriod }) {
  const c = overview.current;
  const p = overview.previous;
  const s = overview.snapshot;
  const prev = period.previousLabel;
  const net = c.collected_kobo - c.refunded_kobo;
  const prevNet = p.collected_kobo - p.refunded_kobo;

  const kpis: Kpi[] = [
    {
      label: "New patients",
      icon: SEMANTIC_ICON.parentCare,
      value: formatNumber(c.registrations),
      delta: compare(c.registrations, p.registrations, prev, true, formatNumber),
      href: "/admin/patients/directory",
    },
    {
      label: "Active Memberships, now",
      icon: NAV_ICON.members,
      value: formatNumber(s.active_memberships),
      delta: { text: `${formatNumber(s.ending_next_30d)} end in the next 30 days`, direction: "flat" },
      href: "/admin/memberships",
    },
    {
      label: "Memberships started",
      icon: NAV_ICON.members,
      value: formatNumber(c.memberships_started),
      delta: compare(c.memberships_started, p.memberships_started, prev, true, formatNumber),
      href: "/admin/memberships",
    },
    {
      label: "Memberships ended or lapsed",
      icon: NAV_ICON.members,
      value: formatNumber(c.memberships_ended),
      delta: compare(c.memberships_ended, p.memberships_ended, prev, false, formatNumber),
      href: "/admin/memberships",
    },
    {
      label: "Collected (Paystack confirmed)",
      icon: SEMANTIC_ICON.billing,
      value: naira(c.collected_kobo),
      delta: compare(c.collected_kobo, p.collected_kobo, prev, true, naira),
      href: "/finance/money-reconciliation",
    },
    {
      label: "Refunded",
      icon: SEMANTIC_ICON.billing,
      value: naira(c.refunded_kobo),
      delta: compare(c.refunded_kobo, p.refunded_kobo, prev, false, naira),
      href: "/admin/refund-requests",
    },
    {
      label: "Net collected",
      icon: SEMANTIC_ICON.billing,
      value: naira(net),
      delta: compare(net, prevNet, prev, true, naira),
      href: "/finance/money-reconciliation",
    },
    {
      label: "Failed payments",
      icon: NAV_ICON.warning,
      value: formatNumber(c.failed_payments),
      delta: compare(c.failed_payments, p.failed_payments, prev, false, formatNumber),
      href: "/admin/ops/providers",
    },
    {
      label: "Failed notifications",
      icon: NAV_ICON.bell,
      value: formatNumber(c.notifications_failed),
      // Both counts, no percentage: a message can be sent and then fail, so "sent" and "failed" overlap and their ratio
      // would not be a true failure rate.
      delta: { text: `${formatNumber(c.notifications_sent)} sent in the period`, direction: c.notifications_failed > 0 ? "down" : "flat" },
      href: "/admin/ops/automation-health",
    },
  ];

  return (
    <section aria-labelledby="kpi-heading" className="space-y-3">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 id="kpi-heading" className="font-heading text-lg font-semibold text-charcoal-ink">
          {period.label}
        </h2>
        <p className="text-xs text-charcoal-ink/55">Each figure is compared with {prev}. Test accounts are left out.</p>
      </div>
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {kpis.map((kpi) => (
          <KpiTile key={kpi.label} kpi={kpi} />
        ))}
      </div>
      <details className="max-w-3xl text-xs text-charcoal-ink/65">
        <summary className="cursor-pointer font-medium">How these figures are worked out</summary>
        <ul className="mt-2 list-disc space-y-1 pl-5">
          <li><strong>New patients</strong>: patient accounts created in the period.</li>
          <li><strong>Memberships started</strong>: Memberships whose start date falls in the period and has arrived. A year bought in advance counts when it starts. <strong>Ended or lapsed</strong> counts those whose end date falls in the period.</li>
          <li><strong>Collected</strong>: money Paystack confirmed, in naira: paid checkout orders (Membership and services, what the payer was charged) and confirmed charges from older payment routes. It is cash received, not recognised revenue and not orders placed; failed and pending charges are never in it. <strong>Refunded</strong> is refunds Paystack processed in the period, shown apart. <strong>Net collected</strong> is collected minus refunded.</li>
          <li><strong>Failed payments</strong>: checkout orders and charge attempts that failed. One person can fail more than once.</li>
          <li><strong>Failed notifications</strong>: in-app, push, email and SMS messages that failed in the period, out of those sent or failed.</li>
          <li>The comparison is the period of the same length just before this one. A rise from nothing shows the old figure, not a percentage.</li>
        </ul>
      </details>
    </section>
  );
}

/** Who is Free, who is a member and who pays for them, right now. */
export function CommercialSplit({ overview }: { overview: Overview }) {
  const s = overview.snapshot;
  const total = s.registered_patients;
  const share = (n: number) => (total === 0 ? "" : ` (${Math.round((n / total) * 100)}%)`);
  const known = new Set<string>(MEMBERSHIP_SOURCES);
  const otherSources = Object.keys(s.active_by_source).filter((k) => !known.has(k));
  const rows: { label: string; n: number }[] = [
    { label: "Free", n: s.free_patients },
    ...[...MEMBERSHIP_SOURCES, ...otherSources].map((source) => ({
      label: `Member: ${(SOURCE_LABEL[source] ?? source).toLowerCase()}`,
      n: s.active_by_source[source] ?? 0,
    })),
  ];
  return (
    <Card>
      <CardHeader>
        <CardTitle>Free and Membership, now</CardTitle>
        <CardDescription>
          {formatNumber(total)} registered patients. A patient is a member while a Membership is active and has started.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <ul className="divide-y divide-charcoal-ink/10 text-sm">
          {rows.map((r) => (
            <li key={r.label} className="flex items-center justify-between gap-3 py-2">
              <span className="text-charcoal-ink/80">{r.label}</span>
              <span className="tabular-nums font-medium text-charcoal-ink">
                {formatNumber(r.n)}
                <span className="font-normal text-charcoal-ink/50">{share(r.n)}</span>
              </span>
            </li>
          ))}
        </ul>
        <p className="mt-3 text-xs text-charcoal-ink/60">
          <Link href="/admin/memberships" className="font-medium text-brand-green hover:underline">
            {formatNumber(s.ending_next_30d)} Membership{s.ending_next_30d === 1 ? "" : "s"} end in the next 30 days
          </Link>
        </p>
      </CardContent>
    </Card>
  );
}

const HEALTH_BADGE: Record<HealthState, "green" | "amber" | "red" | "grey"> = {
  operational: "green",
  degraded: "amber",
  failed: "red",
  unknown: "grey",
  not_configured: "grey",
};

/** Each dependency's state with what it rests on, so a green badge is never just a claim. */
export function SystemHealth({ lines, checkedAt }: { lines: { name: string; line: HealthLine }[]; checkedAt: Date }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>System health</CardTitle>
        <CardDescription>
          Live checks run when this page loaded ({lagosTime(checkedAt)}). A key that is set but has not been checked shows as
          Unknown, not Operational.{" "}
          <Link href="/admin/ops/providers" className="font-medium text-brand-green hover:underline">
            Provider detail
          </Link>
        </CardDescription>
      </CardHeader>
      <CardContent>
        <ul className="divide-y divide-charcoal-ink/10 text-sm">
          {lines.map(({ name, line }) => (
            <li key={name} className="flex flex-wrap items-center justify-between gap-2 py-2">
              <span className="min-w-0">
                <span className="font-medium text-charcoal-ink">{name}</span>
                <span className="block text-xs text-charcoal-ink/60">{line.evidence}</span>
              </span>
              <Badge variant={HEALTH_BADGE[line.state]}>{HEALTH_LABEL[line.state]}</Badge>
            </li>
          ))}
        </ul>
      </CardContent>
    </Card>
  );
}
