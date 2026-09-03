"use client";

import { useState } from "react";
import Link from "next/link";
import {
  useOpsTodaySummary,
  useOpsExceptionQueue,
  useOpsExceptionCounts,
  useOpsSystemHealth,
  type OpsExceptionDomain,
  type OpsExceptionSeverity,
  type OpsHealthStatus,
} from "@/lib/queries/ops-console";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";

const HEALTH_BADGE: Record<OpsHealthStatus, "green" | "amber" | "red"> = {
  operational: "green",
  degraded: "amber",
  down: "red",
};

const SEVERITY_BADGE: Record<OpsExceptionSeverity, "red" | "amber" | "blue"> = {
  critical: "red",
  urgent: "amber",
  high: "blue",
};

const DOMAINS: (OpsExceptionDomain | "all")[] = [
  "all",
  "alerts",
  "appointments",
  "referrals",
  "laboratory",
  "pharmacy",
  "support",
  "payments",
  "incidents",
  "providers",
];

const DOMAIN_LABEL: Record<OpsExceptionDomain | "all", string> = {
  all: "All",
  alerts: "Alerts",
  appointments: "Appointments",
  referrals: "Referrals",
  laboratory: "Laboratory",
  pharmacy: "Pharmacy",
  support: "Support",
  payments: "Payments",
  incidents: "Incidents",
  providers: "Providers",
};

function SystemHealthStrip() {
  const { data, isLoading } = useOpsSystemHealth();
  if (isLoading) return <p className="text-sm text-charcoal-ink/60">Loading…</p>;
  if (!data?.components?.length) return null;

  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-5">
      {data.components.map((c) => (
        <div key={c.key} className="rounded-xl border border-charcoal-ink/10 bg-white p-3">
          <div className="flex items-center justify-between gap-2">
            <p className="text-xs font-medium text-charcoal-ink">{c.label}</p>
            <Badge variant={HEALTH_BADGE[c.status]}>{c.status}</Badge>
          </div>
          <p className="mt-1 text-xs text-charcoal-ink/60">{c.detail}</p>
        </div>
      ))}
    </div>
  );
}

function StatGroup({ title, stats }: { title: string; stats: [string, number][] }) {
  return (
    <div>
      <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-charcoal-ink/50">{title}</p>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        {stats.map(([label, value]) => (
          <div key={label} className="rounded-lg bg-charcoal-ink/5 p-3">
            <p className="text-xs text-charcoal-ink/60">{label}</p>
            <p className="font-heading text-lg font-semibold text-charcoal-ink">{value}</p>
          </div>
        ))}
      </div>
    </div>
  );
}

function TodaySummary() {
  const { data: s, isLoading, isError } = useOpsTodaySummary();
  if (isLoading) return <p className="text-sm text-charcoal-ink/60">Loading…</p>;
  if (isError || !s) return <p className="text-sm text-red-600">Could not load today&apos;s summary.</p>;

  return (
    <div className="space-y-4">
      <StatGroup
        title="Scale"
        stats={[
          ["Active patients", s.patients],
          ["Active care programmes", s.active_care_programmes],
          ["Active subscriptions", s.active_subscriptions],
        ]}
      />
      <StatGroup
        title="Today"
        stats={[
          ["Appointments today", s.appointments_today],
          ["Video consults today", s.consults_today],
          ["Pending bookings", s.pending_bookings],
        ]}
      />
      <StatGroup
        title="Clinical work in hand"
        stats={[
          ["Pending clinical reviews", s.pending_clinical_reviews],
          ["Critical alerts", s.critical_alerts],
          ["Alerts past SLA", s.alerts_past_sla],
          ["Open escalations", s.open_escalations],
        ]}
      />
      <StatGroup
        title="Coordination"
        stats={[
          ["Unresolved referrals", s.unresolved_referrals],
          ["Laboratory delays", s.laboratory_delays],
          ["Pharmacy issues", s.pharmacy_issues],
        ]}
      />
      <StatGroup
        title="Support & money"
        stats={[
          ["Support unread", s.support_unread],
          ["Failed payments (30d)", s.failed_payments],
          ["Reconciliation exceptions", s.reconciliation_exceptions],
        ]}
      />
      <StatGroup
        title="Governance"
        stats={[
          ["Open incidents", s.open_incidents],
          ["Incidents past SLA", s.incidents_past_sla],
          ["Clinician verifications pending", s.clinician_verifications_pending],
        ]}
      />
    </div>
  );
}

function ExceptionQueue() {
  const [domain, setDomain] = useState<OpsExceptionDomain | "all">("all");
  const { data: rows, isLoading, isError } = useOpsExceptionQueue(domain);
  const { data: counts } = useOpsExceptionCounts();

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-1.5">
        {DOMAINS.map((d) => {
          const count = d === "all" ? counts?.total : counts?.by_domain[d as OpsExceptionDomain];
          return (
            <button
              key={d}
              type="button"
              onClick={() => setDomain(d)}
              className={`rounded-full px-3 py-1 text-xs font-medium ${
                domain === d
                  ? "bg-brand-green text-white"
                  : "bg-charcoal-ink/5 text-charcoal-ink/70 hover:bg-charcoal-ink/10"
              }`}
            >
              {DOMAIN_LABEL[d]}
              {count ? ` (${count})` : ""}
            </button>
          );
        })}
      </div>
      {isLoading && <p className="text-sm text-charcoal-ink/60">Loading…</p>}
      {isError && <p className="text-sm text-red-600">Could not load the exception queue.</p>}
      {rows && rows.length === 0 && (
        <p className="text-sm text-charcoal-ink/60">Nothing outstanding in this domain.</p>
      )}
      {rows && rows.length > 0 && (
        <ul className="divide-y divide-charcoal-ink/10">
          {rows.map((r) => (
            <li key={`${r.domain}-${r.entity_id}`} className="py-2.5">
              <Link href={r.href} className="block hover:bg-charcoal-ink/5 rounded-md p-2 -m-2">
                <div className="flex items-center gap-2">
                  <Badge variant={SEVERITY_BADGE[r.severity]}>{r.severity}</Badge>
                  <p className="text-sm font-medium text-charcoal-ink">{r.headline}</p>
                </div>
                <p className="text-xs text-charcoal-ink/60">
                  {r.detail}
                  {r.subject_name && ` · ${r.subject_name}`}
                  {` · open ${r.age_hours}h`}
                </p>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export function OpsConsoleManager() {
  return (
    <div className="space-y-6">
      <SystemHealthStrip />
      <Card>
        <CardHeader>
          <CardTitle>Today</CardTitle>
          <CardDescription>Cross-domain operational scale and work-in-hand.</CardDescription>
        </CardHeader>
        <CardContent>
          <TodaySummary />
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle>Exception queue</CardTitle>
          <CardDescription>
            Everything past its own SLA or otherwise stuck, worst first, across every domain:
            the single worklist this console exists to give you.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <ExceptionQueue />
        </CardContent>
      </Card>
    </div>
  );
}
