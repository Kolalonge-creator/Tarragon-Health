import { createClient } from "@/lib/supabase/server";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

/**
 * Patient/family-facing care team card — docs/CLINICAL_TRUST_MODEL_SPEC.md
 * §2's "Onboarding / dashboard" touchpoint row. Renders nothing until a
 * care_team_assignment row exists for this patient — never shows a
 * placeholder clinician name. The Clinical Director line is a static,
 * same-for-every-patient supervision badge (never claims per-case review —
 * that's ReviewedByDoctor's job, gated separately on a real escalation).
 */
export async function YourCareTeam({ patientId }: { patientId: string }) {
  const supabase = await createClient();

  const { data: assignment } = await supabase
    .from("care_team_assignment")
    .select("clinician_id, clinical_director_id")
    .eq("patient_id", patientId)
    .maybeSingle();

  if (!assignment?.clinician_id) {
    return null;
  }

  const { data: clinician } = await supabase
    .from("clinical_staff")
    .select("full_name, credential_type, credential_number")
    .eq("profile_id", assignment.clinician_id)
    .eq("active", true)
    .maybeSingle();

  if (!clinician) {
    return null;
  }

  const { data: director } = assignment.clinical_director_id
    ? await supabase
        .from("clinical_staff")
        .select("full_name")
        .eq("profile_id", assignment.clinical_director_id)
        .eq("active", true)
        .maybeSingle()
    : { data: null };

  const clinicianCredential =
    clinician.credential_type && clinician.credential_number
      ? `${clinician.credential_type} ${clinician.credential_number}`
      : null;

  return (
    <Card>
      <CardHeader>
        <CardTitle>Your care team</CardTitle>
      </CardHeader>
      <CardContent className="space-y-1">
        <p className="text-sm text-charcoal-ink">
          Your clinician: <span className="font-medium">{clinician.full_name}</span>
          {clinicianCredential && (
            <span className="text-charcoal-ink/60"> · {clinicianCredential}</span>
          )}
        </p>
        {director && (
          <p className="text-sm text-charcoal-ink/60">
            Your care protocols are supervised by Dr. {director.full_name}
          </p>
        )}
      </CardContent>
    </Card>
  );
}
