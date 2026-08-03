import Link from "next/link";
import type { LucideIcon } from "lucide-react";
import { getCurrentProfile, getCurrentClinicalStaff } from "@/lib/auth/current-profile";
import { DOCTOR_TIER_LABEL, DOCTOR_TIER_AUTHORITY_BLURB } from "@/lib/clinical/doctor-tier";
import { DashboardPlaceholder } from "@/components/dashboard-placeholder";
import { Card, CardContent } from "@/components/ui/card";
import { ClinicalStaffSetupWarning } from "@/components/clinical/clinical-staff-setup-warning";
import { WorklistCountStrip, type WorklistCountTile } from "@/components/clinical/worklist-count-strip";
import { createClient } from "@/lib/supabase/server";
import { SEMANTIC_ICON, NAV_ICON } from "@/lib/icons";
import { Worklist } from "./worklist";
import { RedFlagAttestation } from "./red-flag-attestation";
import { AttestationCard } from "./attestation-card";

/**
 * Every worklist this dashboard links to, each paired with the count query
 * that answers "is there actually anything waiting here" — see
 * lib/queries/worklist-counts.ts. This is the one place that turns 13
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

const QUICK_LINKS: { href: string; label: string; blurb: string; icon: LucideIcon }[] = [
  {
    href: "/clinician/escalations",
    label: "Escalations",
    blurb: "All open and resolved escalations",
    icon: SEMANTIC_ICON.escalation,
  },
  {
    href: "/clinician/support-inbox",
    label: "Support inbox",
    blurb: "WhatsApp support messages from patients",
    icon: NAV_ICON.inbox,
  },
  {
    href: "/clinician/messages",
    label: "Patient messages",
    blurb: "In-app care messaging threads",
    icon: NAV_ICON.messages,
  },
  {
    href: "/clinician/referrals",
    label: "Specialist referrals",
    blurb: "Refer and track specialist care",
    icon: NAV_ICON.referral,
  },
  {
    href: "/clinician/medication-reviews",
    label: "Medication reviews",
    blurb: "Scheduled medication review worklist",
    icon: SEMANTIC_ICON.medication,
  },
  {
    href: "/clinician/adherence",
    label: "Adherence alerts",
    blurb: "Missed-dose escalation ladder",
    icon: SEMANTIC_ICON.carePlan,
  },
  {
    href: "/clinician/recommendations",
    label: "Care recommendations",
    blurb: "Programme proposals awaiting review",
    icon: SEMANTIC_ICON.preventive,
  },
  {
    href: "/clinician/vaccinations",
    label: "Vaccination certificates",
    blurb: "Verify patient-uploaded certificates",
    icon: NAV_ICON.vaccination,
  },
  {
    href: "/clinician/preventive-reviews",
    label: "Periodic health reviews",
    blurb: "Preventive programme review cadence",
    icon: NAV_ICON.review,
  },
  {
    href: "/clinician/annual-reviews",
    label: "Annual Doctor Reviews",
    blurb: "Whole-year workup orchestration",
    icon: SEMANTIC_ICON.booking,
  },
  {
    href: "/clinician/lifestyle-flags",
    label: "Lifestyle safety flags",
    blurb: "Safety triggers from lifestyle programmes",
    icon: NAV_ICON.lifestyle,
  },
  {
    href: "/clinician/lifestyle-reviews",
    label: "Lifestyle reviews",
    blurb: "Progress reviews on lifestyle goals",
    icon: NAV_ICON.review,
  },
  {
    href: "/clinician/care-plan-review",
    label: "Care plan review",
    blurb: "Plans that may need attention",
    icon: SEMANTIC_ICON.carePlan,
  },
];

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

  return (
    <DashboardPlaceholder
      greeting={`Welcome${profile?.full_name ? `, ${profile.full_name}` : ""}`}
      roleLabel={roleLabel}
      comingUp={[]}
    >
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
      <section aria-labelledby="worklist-counts-heading" className="space-y-2">
        <h2 id="worklist-counts-heading" className="font-heading text-sm font-medium text-charcoal-ink/60">
          Today, at a glance
        </h2>
        <WorklistCountStrip tiles={WORKLIST_COUNT_TILES} />
      </section>
      <Worklist />
      <section aria-labelledby="clinician-worklists-heading" className="space-y-3">
        <h2
          id="clinician-worklists-heading"
          className="font-heading text-lg font-semibold text-charcoal-ink"
        >
          Worklists &amp; tools
        </h2>
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {QUICK_LINKS.map(({ href, label, blurb, icon: Icon }) => (
            <Link
              key={href}
              href={href}
              className="group flex items-start gap-3 rounded-xl border border-charcoal-ink/10 bg-white p-4 shadow-sm transition-all hover:border-brand-green/40 hover:shadow-md"
            >
              <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-soft-sage">
                <Icon className="h-4.5 w-4.5 text-deep-forest" strokeWidth={2} />
              </span>
              <span className="min-w-0">
                <span className="block text-sm font-medium text-charcoal-ink group-hover:text-deep-forest">
                  {label}
                </span>
                <span className="block truncate text-xs text-charcoal-ink/55">{blurb}</span>
              </span>
            </Link>
          ))}
        </div>
      </section>
    </DashboardPlaceholder>
  );
}
