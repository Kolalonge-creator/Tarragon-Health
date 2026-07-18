import { redirect } from "next/navigation";
import { getCurrentProfile } from "@/lib/auth/current-profile";
import { createClient } from "@/lib/supabase/server";
import { YourCareTeam } from "@/components/your-care-team";
import { OnboardingFlow } from "./onboarding-flow";

export default async function OnboardingPage() {
  const profile = await getCurrentProfile();
  if (!profile) {
    redirect("/login");
  }
  if (profile.role !== "patient") {
    redirect("/");
  }
  if (profile.onboarding_completed_at) {
    redirect("/patient");
  }

  const supabase = await createClient();

  // Consent is complete when the patient has an acceptance row for every
  // current consent version.
  const [{ data: currentVersions }, { data: myConsents }, { count: intakeCount }] =
    await Promise.all([
      supabase.from("consent_versions").select("id").eq("is_current", true),
      supabase.from("patient_consents").select("consent_version_id").eq("patient_id", profile.id),
      supabase
        .from("risk_assessment_responses")
        .select("id", { count: "exact", head: true })
        .eq("profile_id", profile.id),
    ]);

  const acceptedIds = new Set((myConsents ?? []).map((row) => row.consent_version_id));
  const consentDone =
    (currentVersions?.length ?? 0) > 0 &&
    (currentVersions ?? []).every((version) => acceptedIds.has(version.id));

  return (
    <div className="flex flex-1 items-center justify-center bg-charcoal-ink/[0.02] px-4 py-16">
      <OnboardingFlow
        profile={{ id: profile.id, fullName: profile.full_name }}
        careTeamSlot={<YourCareTeam patientId={profile.id} />}
        initial={{
          consentDone,
          demographicsDone: !!profile.date_of_birth && !!profile.sex,
          intakeDone: (intakeCount ?? 0) > 0,
          dateOfBirth: profile.date_of_birth,
          sex: profile.sex,
          location: { state: profile.state, city: profile.city, area: profile.area },
          emergencyContact: {
            emergency_contact_name: profile.emergency_contact_name,
            emergency_contact_phone: profile.emergency_contact_phone,
            emergency_contact_relationship: profile.emergency_contact_relationship,
            emergency_contact_consent: profile.emergency_contact_consent,
            next_of_kin_name: profile.next_of_kin_name,
            next_of_kin_phone: profile.next_of_kin_phone,
          },
        }}
      />
    </div>
  );
}
