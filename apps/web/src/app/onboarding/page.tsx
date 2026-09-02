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
  const [{ data: currentVersions }, { data: myConsents }, { count: intakeCount }, { data: existingSubscription }] =
    await Promise.all([
      supabase.from("consent_versions").select("id").eq("is_current", true),
      supabase.from("patient_consents").select("consent_version_id").eq("patient_id", profile.id),
      supabase
        .from("risk_assessment_responses")
        .select("id", { count: "exact", head: true })
        .eq("profile_id", profile.id),
      // If onboarding_completed_at was ever cleared on an account that
      // already has a real, active-or-pending-payment service purchase — a
      // data migration, an account-recovery flow, anything — this is what
      // prevents them from being walked back through "choose your plan" as
      // if they were a brand-new signup (see existing-plan-notice.tsx).
      // pending_payment is the pay-per-service equivalent of the old
      // subscriptions "trialing" status: money is in flight, not yet
      // confirmed by the payment-provider webhook.
      supabase
        .from("service_purchases")
        .select("status, service_product:service_products(name)")
        .eq("patient_id", profile.id)
        .in("status", ["active", "pending_payment"])
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle(),
    ]);

  const acceptedIds = new Set((myConsents ?? []).map((row) => row.consent_version_id));
  const consentDone =
    (currentVersions?.length ?? 0) > 0 &&
    (currentVersions ?? []).every((version) => acceptedIds.has(version.id));

  return (
    <div className="flex flex-1 items-center justify-center bg-charcoal-ink/[0.02] px-4 py-16">
      <OnboardingFlow
        profile={{ id: profile.id, fullName: profile.full_name }}
        receivesCare={profile.receives_care !== false}
        careTeamSlot={<YourCareTeam patientId={profile.id} />}
        existingPlan={
          existingSubscription
            ? {
                name: existingSubscription.service_product?.name ?? "your plan",
                status: existingSubscription.status,
              }
            : null
        }
        initial={{
          consentDone,
          demographicsDone: !!profile.date_of_birth && !!profile.sex,
          intakeDone: (intakeCount ?? 0) > 0,
          dateOfBirth: profile.date_of_birth,
          sex: profile.sex,
          location: { state: profile.state, city: profile.city, area: profile.area },
        }}
      />
    </div>
  );
}
