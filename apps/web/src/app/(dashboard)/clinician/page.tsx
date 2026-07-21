import Link from "next/link";
import type { LucideIcon } from "lucide-react";
import { getCurrentProfile, getCurrentClinicalStaff } from "@/lib/auth/current-profile";
import { DOCTOR_TIER_LABEL, DOCTOR_TIER_AUTHORITY_BLURB } from "@/lib/clinical/doctor-tier";
import { DashboardPlaceholder } from "@/components/dashboard-placeholder";
import { Card, CardContent } from "@/components/ui/card";
import { createClient } from "@/lib/supabase/server";
import { SEMANTIC_ICON, NAV_ICON } from "@/lib/icons";
import { Worklist } from "./worklist";
import { RedFlagAttestation } from "./red-flag-attestation";
import { AttestationCard } from "./attestation-card";

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
    label: "Annual health reviews",
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

  // Tier 1-4 Doctor Dashboard: one worklist, tier-gated view — per
  // docs/Tarragon_Health_Master_Operating_Plan_v4.md §12 this dashboard is
  // role-gated views of the shared worklist, not a separate dashboard per
  // tier. Falls back to a generic label when the caller has no
  // clinical_staff row yet (e.g. newly added, tier not assigned).
  const roleLabel = staff?.doctor_tier ? DOCTOR_TIER_LABEL[staff.doctor_tier] : "Care Team Doctor";
  const authorityBlurb = staff?.doctor_tier ? DOCTOR_TIER_AUTHORITY_BLURB[staff.doctor_tier] : undefined;

  return (
    <DashboardPlaceholder
      greeting={`Welcome${profile?.full_name ? `, ${profile.full_name}` : ""}`}
      roleLabel={roleLabel}
      comingUp={["Workload metrics (1:120 ratio target)"]}
    >
      {authorityBlurb && (
        <Card variant="soft">
          <CardContent className="py-3 text-sm text-charcoal-ink/70">{authorityBlurb}</CardContent>
        </Card>
      )}
      {staff && <RedFlagAttestation />}
      {attestationStaff && <AttestationCard expiresAt={attestationExpiresAt} />}
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
