import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { createServiceRoleClient } from "@/lib/supabase/service-role";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { MaskedCallButton } from "@/components/masked-call-button";

/**
 * Patient/family-facing care team card — docs/CLINICAL_TRUST_MODEL_SPEC.md
 * §2's "Onboarding / dashboard" touchpoint row, 2026-07-30 team-framing
 * correction. `care_team_assignment.clinician_id` is internal routing/rota
 * only — it is deliberately never rendered here as a named "your doctor",
 * and there is no direct-call path to that standing individual: the spec
 * is explicit that no single Tier 2 doctor's name/photo appears ahead of
 * any review actually happening. A doctor is named (and, on an escalation,
 * callable) only once they've actually reviewed something — that's
 * ReviewedByDoctor's job elsewhere, not this card's. Renders nothing until
 * a care_team_assignment row exists for this patient. The Clinical Director
 * line is a static, same-for-every-patient supervision badge (protocol
 * authorship, not per-case review). The Care Coordinator line is null-gated
 * the same way; the name lookup goes through the service-role client
 * because a patient's RLS can't read a coordinator's profiles row — the
 * RLS-scoped assignment SELECT above is the ownership proof, and only
 * full_name leaves the lookup. Calling the coordinator directly is fine
 * (logistics, not a clinical-continuity promise — see the masked-calling
 * build notes in docs/CLAUDE_SPRINT_HISTORY_ARCHIVE.md).
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
    .select("profile_id")
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

  return (
    <Card>
      <CardHeader>
        <CardTitle>Your care team</CardTitle>
      </CardHeader>
      <CardContent className="space-y-1">
        {/* Do not restore "a team of MDCN-registered doctors" here. Live
            clinical_staff credential numbers are QA-000001 and TEST-0001 to
            TEST-0006, so there is no real MDCN registration on the platform
            yet and the claim is not one we can stand behind. The marketing
            trust band carried the identical sentence and was corrected on
            2026-09-05; this copy is the patient-facing twin of it and is
            reachable from the Overview, Messages and onboarding. What is said
            below is true and DB-enforced: clinical_staff cannot go active
            without verification, and a CHECK constraint stops anyone
            verifying their own record. */}
        <p className="text-sm text-charcoal-ink dark:text-night-ink">
          Your readings are followed by a team of doctors. Whoever reviews a reading or handles
          a check-in is named on that specific note, rather than being assigned to you as a
          single doctor ahead of time, and never named before they have actually reviewed
          something.
        </p>
        {coordinatorName && (
          <>
            <p className="text-sm text-charcoal-ink dark:text-night-ink">
              Your care coordinator: <span className="font-medium">{coordinatorName}.</span>
              <span className="text-charcoal-ink/60 dark:text-night-ink/60">
                {" "}
                They help with bookings, refills and check-ins.{" "}
                <Link href="/patient/messages" className="text-brand-green dark:text-brand-green-bright hover:underline">
                  Send a message
                </Link>
              </span>
            </p>
            {assignment.care_coordinator_id && (
              <MaskedCallButton
                patientId={patientId}
                staffProfileId={assignment.care_coordinator_id}
                otherPartyLabel="your care coordinator"
                context="care_coordination"
              />
            )}
          </>
        )}
        {director && (
          <p className="text-sm text-charcoal-ink/60 dark:text-night-ink/60">
            Your care protocols are supervised by Dr. {director.full_name}
          </p>
        )}
      </CardContent>
    </Card>
  );
}
