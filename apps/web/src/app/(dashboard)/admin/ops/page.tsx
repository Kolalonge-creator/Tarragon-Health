import { redirect } from "next/navigation";
import Link from "next/link";
import { canViewOpsConsole } from "@/lib/auth/permissions";
import { createClient } from "@/lib/supabase/server";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { StatTile } from "@/components/ui/stat-tile";
import { LoadFailure } from "@/components/ui/load-failure";
import { PageHeader } from "@/components/ui/page-header";
import { NAV_ICON } from "@/lib/icons";
import { formatNumber } from "@/lib/analytics/format";
import { ExceptionQueue, type OpsExceptionRow } from "./exception-queue";
import { SystemHealthPanel, type SystemHealthComponent } from "./system-health-panel";

/**
 * Modules 30.3 / 30.8-30.14 / 30.19 — the operations control centre home
 * board. One page rather than the spec's seven separate monitoring screens
 * (see the comment at the top of the ops_control_centre_rpcs migration for
 * why): Tarragon Today's counts, one cross-domain exception queue with a
 * domain filter, and the system health strip, all reading from
 * SECURITY DEFINER RPCs that self-gate on private.can_view_ops_console() —
 * this page guard is a UX nicety, not the enforcement boundary.
 */
type OpsTodaySummary = {
  generated_at: string;
  patients: number;
  active_care_programmes: number;
  active_paid_services: number;
  appointments_today: number;
  consults_today: number;
  pending_clinical_reviews: number;
  critical_alerts: number;
  alerts_past_sla: number;
  open_escalations: number;
  unresolved_referrals: number;
  laboratory_delays: number;
  pharmacy_issues: number;
  pending_bookings: number;
  support_unread: number;
  failed_payments: number;
  reconciliation_exceptions: number;
  open_incidents: number;
  incidents_past_sla: number;
  clinician_verifications_pending: number;
};

function StatGroup({ title, stats }: { title: string; stats: [string, string][] }) {
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

export default async function OpsConsolePage() {
  if (!(await canViewOpsConsole())) {
    redirect("/admin");
  }

  const supabase = await createClient();
  const [summaryRes, queueRes, healthRes] = await Promise.all([
    supabase.rpc("ops_today_summary"),
    supabase.rpc("ops_exception_queue", { p_domain: undefined, p_limit: 200 }),
    supabase.rpc("ops_system_health"),
  ]);

  const summary = (summaryRes.data ?? {}) as Partial<OpsTodaySummary>;
  const queue = (queueRes.data ?? []) as OpsExceptionRow[];
  const healthData = healthRes.data as { components?: SystemHealthComponent[] } | null;
  const health = healthData?.components ?? [];

  // ops_today_summary is one RPC behind about twenty tiles. A failure left it
  // as `{}`, so every tile below rendered 0: no critical alerts, no pending
  // clinical reviews, no incidents past SLA, nothing failing. That is the
  // single most reassuring screen the platform can draw, produced entirely by
  // a broken read.
  const summaryFailed = summaryRes.error !== null;

  const n = (v: number | undefined) => formatNumber(v ?? 0);

  return (
    <div className="space-y-6">
      <PageHeader
        title="Tarragon Today"
        description="The operational state of the platform, right now: one queue across appointments, referrals, laboratory, pharmacy, alerts, support and payments, instead of seven tabs."
        actions={
          <Link
            href="/admin/ops/incidents"
            className="inline-flex items-center gap-2 rounded-lg border border-charcoal-ink/15 bg-white px-4 py-2 text-sm font-medium text-charcoal-ink hover:bg-warm-ivory"
          >
            Incident register
          </Link>
        }
      />

      {summaryFailed && (
        <LoadFailure>
          Today&apos;s counts could not be loaded, so nothing below can be read as zero: not the
          critical alerts, not the pending clinical reviews, not the open incidents. Every queue
          still opens from the sidebar and the exception queue further down loads separately.
          Reload this page to try again.
        </LoadFailure>
      )}

      {!summaryFailed && (
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
        <StatTile icon={NAV_ICON.users} label="Active patients" value={n(summary.patients)} />
        <StatTile
          icon={NAV_ICON.review}
          label="Active care programmes"
          value={n(summary.active_care_programmes)}
        />
        <StatTile
          icon={NAV_ICON.dashboard}
          label="Appointments today"
          value={n(summary.appointments_today)}
        />
        <StatTile
          icon={NAV_ICON.warning}
          tintClassName={(summary.pending_clinical_reviews ?? 0) > 0 ? "bg-amber-100" : undefined}
          iconClassName={(summary.pending_clinical_reviews ?? 0) > 0 ? "text-amber-700" : undefined}
          label="Pending clinical reviews"
          value={n(summary.pending_clinical_reviews)}
        />
        <StatTile
          icon={NAV_ICON.siren}
          tintClassName={(summary.critical_alerts ?? 0) > 0 ? "bg-red-100" : undefined}
          iconClassName={(summary.critical_alerts ?? 0) > 0 ? "text-red-700" : undefined}
          label="Critical alerts"
          value={n(summary.critical_alerts)}
        />
        <StatTile
          icon={NAV_ICON.referral}
          label="Unresolved referrals"
          value={n(summary.unresolved_referrals)}
        />
        <StatTile
          icon={NAV_ICON.review}
          label="Laboratory delays"
          value={n(summary.laboratory_delays)}
        />
        <StatTile icon={NAV_ICON.payables} label="Pharmacy issues" value={n(summary.pharmacy_issues)} />
        <StatTile
          icon={NAV_ICON.messages}
          label="Support unread"
          value={n(summary.support_unread)}
        />
        <StatTile
          icon={NAV_ICON.siren}
          tintClassName={(summary.open_incidents ?? 0) > 0 ? "bg-amber-100" : undefined}
          iconClassName={(summary.open_incidents ?? 0) > 0 ? "text-amber-700" : undefined}
          label="Open incidents"
          value={n(summary.open_incidents)}
        />
      </div>
      )}

      <SystemHealthPanel components={health} loadFailed={healthRes.error !== null} />

      {!summaryFailed && (
      <Card>
        <CardHeader>
          <CardTitle>Full snapshot</CardTitle>
          <CardDescription>
            Everything else the day-summary tracks, beyond the headline tiles above.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <StatGroup
            title="Scale"
            stats={[
              ["Active paid services", n(summary.active_paid_services)],
              ["Video consults today", n(summary.consults_today)],
              ["Pending bookings", n(summary.pending_bookings)],
            ]}
          />
          <StatGroup
            title="Clinical work in hand"
            stats={[
              ["Alerts past SLA", n(summary.alerts_past_sla)],
              ["Open escalations", n(summary.open_escalations)],
            ]}
          />
          <StatGroup
            title="Support & money"
            stats={[
              ["Failed payments (30d)", n(summary.failed_payments)],
              ["Reconciliation exceptions", n(summary.reconciliation_exceptions)],
            ]}
          />
          <StatGroup
            title="Governance"
            stats={[
              ["Incidents past SLA", n(summary.incidents_past_sla)],
              ["Clinician verifications pending", n(summary.clinician_verifications_pending)],
            ]}
          />
        </CardContent>
      </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle>Exception queue</CardTitle>
          <CardDescription>
            Every appointment, referral, lab order, pharmacy order, alert, support message,
            payment and incident that needs a person to act on it, worst first. Filter by domain
            below.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <ExceptionQueue initialRows={queue} loadFailed={queueRes.error !== null} />
        </CardContent>
      </Card>
    </div>
  );
}
