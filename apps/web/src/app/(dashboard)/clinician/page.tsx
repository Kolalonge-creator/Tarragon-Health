import Link from "next/link";
import { getCurrentProfile, getCurrentClinicalStaff } from "@/lib/auth/current-profile";
import { DOCTOR_TIER_LABEL, DOCTOR_TIER_AUTHORITY_BLURB } from "@/lib/clinical/doctor-tier";
import { DashboardPlaceholder } from "@/components/dashboard-placeholder";
import { Card, CardContent } from "@/components/ui/card";
import { createClient } from "@/lib/supabase/server";
import { Worklist } from "./worklist";
import { RedFlagAttestation } from "./red-flag-attestation";
import { AttestationCard } from "./attestation-card";

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
      <p className="text-sm">
        <Link href="/clinician/escalations" className="text-brand-green hover:underline">
          View all escalations →
        </Link>
      </p>
      <p className="text-sm">
        <Link href="/clinician/support-inbox" className="text-brand-green hover:underline">
          Support inbox →
        </Link>
      </p>
      <p className="text-sm">
        <Link href="/clinician/messages" className="text-brand-green hover:underline">
          Patient messages →
        </Link>
      </p>
      <p className="text-sm">
        <Link href="/clinician/referrals" className="text-brand-green hover:underline">
          Specialist referrals →
        </Link>
      </p>
      <p className="text-sm">
        <Link href="/clinician/medication-reviews" className="text-brand-green hover:underline">
          Medication reviews →
        </Link>
      </p>
      <p className="text-sm">
        <Link href="/clinician/adherence" className="text-brand-green hover:underline">
          Adherence alerts →
        </Link>
      </p>
      <p className="text-sm">
        <Link href="/clinician/recommendations" className="text-brand-green hover:underline">
          Care programme recommendations →
        </Link>
      </p>
      <p className="text-sm">
        <Link href="/clinician/vaccinations" className="text-brand-green hover:underline">
          Vaccination certificates →
        </Link>
      </p>
      <p className="text-sm">
        <Link href="/clinician/preventive-reviews" className="text-brand-green hover:underline">
          Periodic health reviews →
        </Link>
      </p>
      <p className="text-sm">
        <Link href="/clinician/annual-reviews" className="text-brand-green hover:underline">
          Annual Doctor Reviews →
        </Link>
      </p>
      <p className="text-sm">
        <Link href="/clinician/lifestyle-flags" className="text-brand-green hover:underline">
          Lifestyle safety flags →
        </Link>
      </p>
      <p className="text-sm">
        <Link href="/clinician/lifestyle-reviews" className="text-brand-green hover:underline">
          Lifestyle reviews →
        </Link>
      </p>
      <p className="text-sm">
        <Link href="/clinician/care-plan-review" className="text-brand-green hover:underline">
          Care plans that may need review →
        </Link>
      </p>
    </DashboardPlaceholder>
  );
}
