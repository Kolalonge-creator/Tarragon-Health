import Link from "next/link";
import { getCurrentProfile, getCurrentClinicalStaff } from "@/lib/auth/current-profile";
import { DOCTOR_TIER_LABEL, DOCTOR_TIER_AUTHORITY_BLURB } from "@/lib/clinical/doctor-tier";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { StatTile } from "@/components/ui/stat-tile";
import { ClinicalStaffSetupWarning } from "@/components/clinical/clinical-staff-setup-warning";
import { WorklistCountStrip, type WorklistCountTile } from "@/components/clinical/worklist-count-strip";
import { formatNumber } from "@/lib/analytics/format";
import { LEVEL_BADGE, ESCALATION_STATUS_BADGE } from "@/lib/worklist/level-badge";
import { createClient } from "@/lib/supabase/server";
import { SEMANTIC_ICON } from "@/lib/icons";
import { Worklist } from "./worklist";
import { RedFlagAttestation } from "./red-flag-attestation";
import { AttestationCard } from "./attestation-card";
import { TodaysQueuePanel } from "./todays-queue-panel";
import type { EscalationLevel } from "@tarragon/shared";

type OverviewEscalationRow = {
  id: string;
  reason: string;
  status: "open" | "under_review" | "resolved" | "referred";
  patient: { full_name: string | null } | null;
  clinician_alert: { level: EscalationLevel; sla_due_at: string | null } | null;
};

/**
 * Every worklist this dashboard links to, each paired with the count query
 * that answers "is there actually anything waiting here" — see
 * lib/queries/worklist-counts.ts. This is the one place that turns 14
 * badge-free pages into a single at-a-glance "today" view.
 */
const WORKLIST_COUNT_TILES: WorklistCountTile[] = [
  { key: "escalations", href: "/clinician/escalations", label: "Open escalations", icon: "escalation" },
  { key: "outreach", href: "/clinician/outreach", label: "Outreach tasks", icon: "messages" },
  { key: "asyncConsults", href: "/clinician/async-consults", label: "Async consults", icon: "inbox" },
  { key: "referralsNeedingUrgency", href: "/clinician/referrals", label: "Referrals to triage", icon: "referral" },
  { key: "waitlistedReferrals", href: "/clinician/referrals/waitlisted", label: "Waitlisted referrals", icon: "referral" },
  { key: "adherenceAlerts", href: "/clinician/adherence", label: "Adherence alerts", icon: "medication" },
  { key: "recommendations", href: "/clinician/recommendations", label: "Care recommendations", icon: "carePlan" },
  { key: "vaccinationVerifications", href: "/clinician/vaccinations", label: "Vaccinations to verify", icon: "vaccination" },
  { key: "lifestyleFlags", href: "/clinician/lifestyle-flags", label: "Lifestyle safety flags", icon: "lifestyle" },
  { key: "medicationReviews", href: "/clinician/medication-reviews", label: "Medication reviews", icon: "medication" },
  { key: "annualReviews", href: "/clinician/annual-reviews", label: "Annual reviews", icon: "review" },
  { key: "preventiveReviews", href: "/clinician/preventive-reviews", label: "Preventive reviews", icon: "preventive" },
  { key: "lifestyleReviews", href: "/clinician/lifestyle-reviews", label: "Lifestyle reviews", icon: "lifestyle" },
  { key: "carePlanReviewPrompts", href: "/clinician/care-plan-review", label: "Care plans to review", icon: "carePlan" },
];

const LEVEL_PRIORITY: Record<EscalationLevel, number> = {
  emergency: 0,
  urgent_escalation: 1,
  clinician_review: 2,
  routine: 3,
};

/** Lagos-local time of day (CLAUDE.md: timezone always Africa/Lagos), not the server's own. */
function greetingWord(now: Date): string {
  const hour = Number(
    new Intl.DateTimeFormat("en-GB", {
      hour: "numeric",
      hour12: false,
      timeZone: "Africa/Lagos",
    }).format(now)
  );
  if (hour < 12) return "Good morning";
  if (hour < 17) return "Good afternoon";
  return "Good evening";
}

function initials(name: string | null | undefined): string {
  if (!name) return "•";
  return (
    name
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((part) => part[0]?.toUpperCase())
      .join("") || "•"
  );
}

export default async function ClinicianPage() {
  const profile = await getCurrentProfile();
  const staff = await getCurrentClinicalStaff();

  // Red-flag attestation status (AHC pathway §26) — shown only to an active
  // clinical_staff member. Resolves the caller's staff row + latest attestation.
  const supabase = await createClient();
  const { data: attestationStaff } = await supabase
    .from("clinical_staff")
    .select("id")
    .eq("profile_id", profile?.id ?? "")
    .eq("active", true)
    .maybeSingle();
  let attestationExpiresAt: string | null = null;
  if (attestationStaff) {
    const { data: latest } = await supabase
      .from("clinical_staff_attestations")
      .select("expires_at")
      .eq("clinical_staff_id", attestationStaff.id)
      .order("expires_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    attestationExpiresAt = latest?.expires_at ?? null;
  }

  // Unified doctor dashboard (founder decision 2026-07-31): every doctor,
  // Tier 1-5, gets the same page access — doctor_tier still drives clinical
  // authority (prescribing, refill-confirmation), just not which pages a
  // doctor can reach. Falls back to a generic label when the caller has no
  // clinical_staff row yet (e.g. newly added, tier not assigned).
  const roleLabel = staff?.doctor_tier ? DOCTOR_TIER_LABEL[staff.doctor_tier] : "Doctor";
  const authorityBlurb = staff?.doctor_tier ? DOCTOR_TIER_AUTHORITY_BLURB[staff.doctor_tier] : undefined;

  // Overview KPIs + the "Urgent escalations" panel share one fetch of every
  // open/under-review escalation — same filter as lib/queries/worklist-counts's
  // countOpenEscalations and lib/queries/escalations's fetchDoctorEscalations,
  // just run with the server client so this page stays a single request.
  const [patientCountRes, escalationsRes, medReviewsRes, carePlanReviewsRes] = await Promise.all([
    supabase.from("profiles").select("id", { count: "exact", head: true }).eq("role", "patient"),
    supabase
      .from("escalations")
      .select(
        "id, reason, status, patient:profiles!escalations_patient_id_fkey(full_name), clinician_alert:clinician_alerts!escalations_clinician_alert_id_fkey(level, sla_due_at)"
      )
      .in("status", ["open", "under_review"])
      .order("created_at", { ascending: true })
      .returns<OverviewEscalationRow[]>(),
    supabase.from("medication_reviews").select("id", { count: "exact", head: true }).eq("status", "pending"),
    supabase
      .from("care_plan_review_prompts")
      .select("id", { count: "exact", head: true })
      .eq("status", "open"),
  ]);

  const patientCount = patientCountRes.count ?? 0;
  const openEscalations = escalationsRes.data ?? [];
  const escalationCount = openEscalations.length;
  const slaBreaches = openEscalations.filter(
    (e) => e.clinician_alert?.sla_due_at && new Date(e.clinician_alert.sla_due_at) < new Date()
  ).length;
  const reviewsDue = (medReviewsRes.count ?? 0) + (carePlanReviewsRes.count ?? 0);

  const urgentEscalations = openEscalations
    .slice()
    .sort((a, b) => {
      const pa = LEVEL_PRIORITY[a.clinician_alert?.level ?? "routine"];
      const pb = LEVEL_PRIORITY[b.clinician_alert?.level ?? "routine"];
      if (pa !== pb) return pa - pb;
      const slaA = a.clinician_alert?.sla_due_at ? new Date(a.clinician_alert.sla_due_at).getTime() : Infinity;
      const slaB = b.clinician_alert?.sla_due_at ? new Date(b.clinician_alert.sla_due_at).getTime() : Infinity;
      return slaA - slaB;
    })
    .slice(0, 5);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-heading text-2xl font-semibold tracking-tight text-charcoal-ink sm:text-3xl">
          {greetingWord(new Date())}
          {profile?.full_name ? `, ${profile.full_name}` : ""}
        </h1>
        <p className="text-sm text-charcoal-ink/60">Here&apos;s what needs you today.</p>
      </div>

      {/* is_clinical_director is orthogonal to doctor_tier and to the now-
          unified account role — a Director keeps every capability this
          dashboard grants any other doctor, plus the protocol/config
          sign-off authority gated separately at /admin/settings/*. This
          badge is purely visible confirmation that the distinction still
          exists; it grants nothing on its own. */}
      {staff?.is_clinical_director && (
        <span className="inline-flex w-fit items-center rounded-full bg-sprout-gold/15 px-2.5 py-1 text-xs font-medium text-deep-forest">
          Clinical Director
        </span>
      )}
      {!staff && <ClinicalStaffSetupWarning roleLabel={roleLabel} />}
      {authorityBlurb && (
        <Card variant="soft">
          <CardContent className="py-3 text-sm text-charcoal-ink/70">{authorityBlurb}</CardContent>
        </Card>
      )}
      {staff && <RedFlagAttestation />}
      {attestationStaff && <AttestationCard expiresAt={attestationExpiresAt} />}

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatTile
          icon={SEMANTIC_ICON.parentCare}
          label="Active patients"
          value={formatNumber(patientCount)}
        />
        <StatTile
          icon={SEMANTIC_ICON.escalation}
          label="Escalations open"
          value={String(escalationCount)}
          delta={{
            text: escalationCount > 0 ? "Awaiting review" : "Within target",
            direction: escalationCount > 0 ? "down" : "up",
          }}
        />
        <StatTile
          icon={SEMANTIC_ICON.carePlan}
          label="Reviews due"
          value={String(reviewsDue)}
          delta={{ text: "Across care plans & meds", direction: "flat" }}
        />
        <StatTile
          icon={SEMANTIC_ICON.escalation}
          tintClassName={slaBreaches > 0 ? "bg-red-100" : undefined}
          iconClassName={slaBreaches > 0 ? "text-red-700" : undefined}
          label="SLA breaches"
          value={String(slaBreaches)}
          delta={{
            text: slaBreaches > 0 ? "Needs immediate attention" : "None right now",
            direction: slaBreaches > 0 ? "down" : "up",
          }}
        />
      </div>

      <div className="grid gap-4 lg:grid-cols-[1.6fr_1fr] lg:items-start">
        <Card>
          <CardHeader>
            <div className="flex items-center justify-between gap-3">
              <CardTitle>Urgent escalations</CardTitle>
              <Link
                href="/clinician/escalations"
                className="shrink-0 text-sm font-medium text-brand-green hover:underline"
              >
                View all →
              </Link>
            </div>
            <CardDescription>Ranked by severity, then how close each is to its SLA.</CardDescription>
          </CardHeader>
          <CardContent>
            {urgentEscalations.length === 0 ? (
              <p className="text-sm text-charcoal-ink/60">No open escalations right now.</p>
            ) : (
              <ul className="divide-y divide-charcoal-ink/10">
                {urgentEscalations.map((escalation) => {
                  const level = escalation.clinician_alert?.level;
                  const levelBadge = level ? LEVEL_BADGE[level] : null;
                  const statusBadge = ESCALATION_STATUS_BADGE[escalation.status];
                  return (
                    <li key={escalation.id}>
                      <Link
                        href={`/clinician/escalations/${escalation.id}`}
                        className="flex items-center justify-between gap-3 py-2.5 hover:bg-charcoal-ink/[0.02]"
                      >
                        <span className="flex min-w-0 items-center gap-3">
                          <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-soft-sage font-heading text-xs font-semibold text-deep-forest">
                            {initials(escalation.patient?.full_name)}
                          </span>
                          <span className="min-w-0">
                            <span className="block truncate text-sm font-medium text-charcoal-ink">
                              {escalation.patient?.full_name ?? "Unknown patient"}
                            </span>
                            <span className="block truncate text-xs text-charcoal-ink/55">
                              {escalation.reason}
                            </span>
                          </span>
                        </span>
                        <span className="flex shrink-0 items-center gap-1.5">
                          {levelBadge && <Badge variant={levelBadge.variant}>{levelBadge.label}</Badge>}
                          <Badge variant={statusBadge.variant}>{statusBadge.label}</Badge>
                        </span>
                      </Link>
                    </li>
                  );
                })}
              </ul>
            )}
          </CardContent>
        </Card>

        <TodaysQueuePanel />
      </div>

      <Worklist />

      <section aria-labelledby="all-worklists-heading" className="space-y-2">
        <h2 id="all-worklists-heading" className="font-heading text-sm font-medium text-charcoal-ink/60">
          All worklists
        </h2>
        <WorklistCountStrip tiles={WORKLIST_COUNT_TILES} />
      </section>
    </div>
  );
}
