import { getCurrentProfile, getCurrentClinicalStaff } from "@/lib/auth/current-profile";
import { DOCTOR_TIER_LABEL, DOCTOR_TIER_AUTHORITY_BLURB } from "@/lib/clinical/doctor-tier";
import { DashboardPlaceholder } from "@/components/dashboard-placeholder";
import { Card, CardContent } from "@/components/ui/card";
import { SEMANTIC_ICON } from "@/lib/icons";
import { EscalationWorklist } from "./escalation-worklist";

export default async function DoctorPage() {
  const profile = await getCurrentProfile();
  const staff = await getCurrentClinicalStaff();

  // Tier 4/5 band of the same tier-gated doctor dashboard as /clinician
  // (Tier 1-3) — docs/Tarragon_Health_Master_Operating_Plan_v4.md §4.
  const roleLabel = staff?.doctor_tier ? DOCTOR_TIER_LABEL[staff.doctor_tier] : "Doctor";
  const authorityBlurb = staff?.doctor_tier ? DOCTOR_TIER_AUTHORITY_BLURB[staff.doctor_tier] : undefined;

  return (
    <DashboardPlaceholder
      greeting={`Welcome${profile?.full_name ? `, ${profile.full_name}` : ""}`}
      roleLabel={roleLabel}
      comingUp={[]}
      icon={SEMANTIC_ICON.escalation}
    >
      {authorityBlurb && (
        <Card variant="soft">
          <CardContent className="py-3 text-sm text-charcoal-ink/70">{authorityBlurb}</CardContent>
        </Card>
      )}
      <EscalationWorklist />
    </DashboardPlaceholder>
  );
}
