import Link from "next/link";
import { redirect } from "next/navigation";
import {
  AlarmClock,
  BellRing,
  HeartPulse,
  ShieldAlert,
  ShieldCheck,
  Siren,
  Split,
} from "lucide-react";
import { getCurrentProfile } from "@/lib/auth/current-profile";
import { createClient } from "@/lib/supabase/server";
import { PageHeader } from "@/components/ui/page-header";
import { StatTile } from "@/components/ui/stat-tile";
import { Badge } from "@/components/ui/badge";
import {
  fetchSafetyMetrics,
  safetyConcerns,
  NEAR_MISS_WINDOW_LABEL,
} from "@/lib/clinical/safety-metrics";
import {
  INCIDENT_CATEGORY_LABEL,
  INCIDENT_SEVERITY_SHORT,
  INCIDENT_SEVERITY_VARIANT,
  INCIDENT_STATUS_LABEL,
  UNRESOLVED_INCIDENT_STATUSES,
  type IncidentCategory,
  type IncidentSeverity,
  type IncidentStatus,
} from "@/lib/clinical/incident-governance";

export const metadata = { title: "Clinical safety" };

function formatMoment(value: string): string {
  return new Date(value).toLocaleString("en-GB", {
    timeZone: "Africa/Lagos",
    dateStyle: "medium",
    timeStyle: "short",
  });
}

/**
 * The clinical safety dashboard (spec §31.12), plus the standing
 * safety-monitoring lists behind two of its numbers (§31.17).
 *
 * Read-only, and deliberately organisation-wide rather than "my cases": this
 * is the view clinical leadership uses to see whether the safety-management
 * system is actually working. RLS scopes every count to the viewer's own
 * organisation, so nothing here reaches past the caller's own permissions to
 * assemble a management number.
 */
export default async function ClinicalSafetyPage() {
  const profile = await getCurrentProfile();
  if (profile?.role !== "clinician" && profile?.role !== "care_coordinator") {
    redirect("/dashboard");
  }

  const supabase = await createClient();
  const metrics = await fetchSafetyMetrics(supabase);
  const concerns = safetyConcerns(metrics);

  // category/severity/status are CHECK constraints, not Postgres enums, so
  // the generated select type widens all three to bare `string` — the two
  // `.in()` filters above already guarantee the narrower values at runtime.
  type SeriousIncidentRow = {
    id: string;
    category: IncidentCategory;
    severity: IncidentSeverity;
    status: IncidentStatus;
    description: string;
    reported_at: string;
  };

  const [{ data: seriousOpen }, { data: criticalUnacked }] = await Promise.all([
    supabase
      .from("clinical_incident_reports")
      .select("id, category, severity, status, description, reported_at")
      .in("status", UNRESOLVED_INCIDENT_STATUSES)
      .in("severity", ["high", "critical"])
      .order("reported_at", { ascending: false })
      .limit(10)
      .returns<SeriousIncidentRow[]>(),
    supabase
      .from("clinician_alerts")
      .select("id, title, level, created_at, sla_due_at, patient_id")
      .eq("status", "open")
      .eq("suppressed", false)
      .in("level", ["urgent_escalation", "emergency"])
      .order("created_at", { ascending: true })
      .limit(10),
  ]);

  return (
    <div className="space-y-6">
      <PageHeader
        icon={ShieldCheck}
        title="Clinical safety"
        description="How the safety-management system is doing right now — what has been reported, what is still unattended, and what is overdue. Every number is for your organisation as a whole, not just your own caseload."
      />

      {concerns.length > 0 ? (
        <div className="rounded-xl border border-red-200 bg-red-50 p-4">
          <p className="text-sm font-medium text-red-800">Needs attention now</p>
          <ul className="mt-1 list-disc space-y-0.5 pl-5 text-sm text-red-700">
            {concerns.map((concern) => (
              <li key={concern}>{concern}</li>
            ))}
          </ul>
        </div>
      ) : (
        <div className="rounded-xl border border-green-200 bg-green-50 p-4 text-sm text-green-800">
          Nothing unattended: no critical alert is waiting to be picked up, no serious incident is
          still open, and no clinical review is past its due date.
        </div>
      )}

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        <StatTile
          icon={ShieldAlert}
          label="Open incidents"
          value={String(metrics.openIncidents)}
          tintClassName="bg-amber-100"
          iconClassName="text-amber-700"
        />
        <StatTile
          icon={Siren}
          label="Serious incidents"
          value={String(metrics.seriousIncidents)}
          tintClassName={metrics.seriousIncidents > 0 ? "bg-red-100" : "bg-charcoal-ink/10"}
          iconClassName={metrics.seriousIncidents > 0 ? "text-red-700" : "text-charcoal-ink/60"}
          delta={{ text: "High or critical, still open", direction: "flat" }}
        />
        <StatTile
          icon={HeartPulse}
          label="Near misses"
          value={String(metrics.nearMisses90d)}
          // Not tinted as a warning on purpose: near misses reported is a
          // sign the reporting culture is working, not a problem to fix.
          tintClassName="bg-soft-sage"
          iconClassName="text-deep-forest"
          delta={{ text: `Reported in the ${NEAR_MISS_WINDOW_LABEL}`, direction: "flat" }}
        />
        <StatTile
          icon={AlarmClock}
          label="Overdue clinical reviews"
          value={String(metrics.overdueClinicalReviews)}
          tintClassName={metrics.overdueClinicalReviews > 0 ? "bg-amber-100" : "bg-charcoal-ink/10"}
          iconClassName={
            metrics.overdueClinicalReviews > 0 ? "text-amber-700" : "text-charcoal-ink/60"
          }
          delta={{ text: "Medication reviews past due", direction: "flat" }}
        />
        <StatTile
          icon={BellRing}
          label="Unacknowledged critical"
          value={String(metrics.unacknowledgedCritical)}
          tintClassName={metrics.unacknowledgedCritical > 0 ? "bg-red-100" : "bg-charcoal-ink/10"}
          iconClassName={
            metrics.unacknowledgedCritical > 0 ? "text-red-700" : "text-charcoal-ink/60"
          }
          delta={{ text: "Urgent or emergency, nobody on it", direction: "flat" }}
        />
        <StatTile
          icon={Split}
          label="Referral failures"
          value={String(metrics.referralFailures)}
          tintClassName="bg-amber-100"
          iconClassName="text-amber-700"
          delta={{ text: "Specialist referrals declined", direction: "flat" }}
        />
      </div>

      <section className="space-y-3">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h2 className="font-heading text-lg font-semibold text-charcoal-ink">
            Serious incidents still open
          </h2>
          <Link href="/clinician/incidents" className="text-sm font-medium text-brand-green hover:underline">
            Open the full incident log
          </Link>
        </div>
        {seriousOpen && seriousOpen.length > 0 ? (
          <ul className="space-y-2">
            {seriousOpen.map((incident) => (
              <li
                key={incident.id}
                className="rounded-xl border border-charcoal-ink/10 bg-white p-3 shadow-sm"
              >
                <div className="flex flex-wrap items-center gap-2">
                  <Badge variant={INCIDENT_SEVERITY_VARIANT[incident.severity]}>
                    {INCIDENT_SEVERITY_SHORT[incident.severity]}
                  </Badge>
                  <span className="text-sm font-medium text-charcoal-ink">
                    {INCIDENT_CATEGORY_LABEL[incident.category]}
                  </span>
                  <span className="text-xs text-charcoal-ink/60">
                    {INCIDENT_STATUS_LABEL[incident.status]} · reported{" "}
                    {formatMoment(incident.reported_at)}
                  </span>
                </div>
                <p className="mt-1 line-clamp-2 text-sm text-charcoal-ink/75">
                  {incident.description}
                </p>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-sm text-charcoal-ink/60">
            No high or critical incident is currently open.
          </p>
        )}
      </section>

      <section className="space-y-3">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h2 className="font-heading text-lg font-semibold text-charcoal-ink">
            Critical alerts nobody has picked up
          </h2>
          <Link
            href="/clinician/escalations"
            className="text-sm font-medium text-brand-green hover:underline"
          >
            Go to escalations
          </Link>
        </div>
        {criticalUnacked && criticalUnacked.length > 0 ? (
          <ul className="space-y-2">
            {criticalUnacked.map((alert) => {
              const breached = alert.sla_due_at !== null && new Date(alert.sla_due_at) < new Date();
              return (
                <li
                  key={alert.id}
                  className="rounded-xl border border-charcoal-ink/10 bg-white p-3 shadow-sm"
                >
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge variant={alert.level === "emergency" ? "red" : "amber"}>
                      {alert.level === "emergency" ? "Emergency" : "Urgent"}
                    </Badge>
                    {breached && <Badge variant="red">Past its response deadline</Badge>}
                    <span className="text-sm font-medium text-charcoal-ink">{alert.title}</span>
                  </div>
                  <p className="mt-1 text-xs text-charcoal-ink/60">
                    Raised {formatMoment(alert.created_at)}
                  </p>
                </li>
              );
            })}
          </ul>
        ) : (
          <p className="text-sm text-charcoal-ink/60">
            Every urgent and emergency alert has been picked up.
          </p>
        )}
      </section>
    </div>
  );
}
