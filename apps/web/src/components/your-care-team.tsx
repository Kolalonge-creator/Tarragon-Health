import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { createServiceRoleClient } from "@/lib/supabase/service-role";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

/**
 * Patient/family-facing care team card — docs/CLINICAL_TRUST_MODEL_SPEC.md
 * §2's "Onboarding / dashboard" touchpoint row. Renders nothing until a
 * care_team_assignment row exists for this patient — never shows a
 * placeholder clinician name. The Clinical Director line is a static,
 * same-for-every-patient supervision badge (never claims per-case review —
 * that's ReviewedByDoctor's job, gated separately on a real escalation).
 * The Care Coordinator line (Maven "Care Advocate" surface) is null-gated the
 * same way; the name lookup goes through the service-role client because a
 * patient's RLS can't read a coordinator's profiles row — the RLS-scoped
 * assignment SELECT above is the ownership proof, and only full_name leaves
 * the lookup.
 */
export async function YourCareTeam({ patientId }: { patientId: string }) {
  const supabase = await createClient();

  const { data: assignment } = await supabase
    .from("care_team_assignment")
    .select("clinician_id, clinical_director_id, care_coordinator_id")
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

  let coordinatorName: string | null = null;
  if (assignment.care_coordinator_id) {
    const service = createServiceRoleClient();
    const { data: coordinator } = await service
      .from("profiles")
      .select("full_name")
      .eq("id", assignment.care_coordinator_id)
      .eq("role", "care_coordinator")
      .maybeSingle();
    coordinatorName = coordinator?.full_name ?? null;
  }

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
          Your doctor: <span className="font-medium">{clinician.full_name}</span>
          {clinicianCredential && (
            <span className="text-charcoal-ink/60"> · {clinicianCredential}</span>
          )}
        </p>
        {coordinatorName && (
          <p className="text-sm text-charcoal-ink">
            Your care coordinator: <span className="font-medium">{coordinatorName}</span>
            <span className="text-charcoal-ink/60">
              {" "}
              — they help with bookings, refills and check-ins.{" "}
              <Link href="/patient/messages" className="text-brand-green hover:underline">
                Send a message
              </Link>
            </span>
          </p>
        )}
        {director && (
          <p className="text-sm text-charcoal-ink/60">
            Your care protocols are supervised by Dr. {director.full_name}
          </p>
        )}
      </CardContent>
    </Card>
  );
}
