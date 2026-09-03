import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getLifestyleState, getPastLifestyleGoals } from "@/lib/lifestyle/service";
import { SEMANTIC_ICON } from "@/lib/icons";
import { obesityLabelTitleCase } from "@/lib/copy/condition-language";
import { ObesitySummary } from "@/app/(dashboard)/patient/obesity-summary";
import { AtAGlancePanel } from "@/app/(dashboard)/patient/lifestyle/lifestyle-client";
import { ConditionEnrollmentCard } from "@/app/(dashboard)/patient/lifestyle/condition-enrollment-card";
import { GoalsDialog } from "@/app/(dashboard)/patient/lifestyle/goals-dialog";
import { BariatricReferralStatus } from "./bariatric-referral-status";
import { WeightEducationFeed } from "./weight-education-feed";
import { WeightEnrollCta } from "./weight-enroll-cta";

/**
 * The single home for everything weight-related — the doctor's assessment
 * (ObesitySummary), the obesity lifestyle programme, quick weight/activity
 * tracking, a bariatric-referral status card when one exists, and weight-
 * specific education. Pure composition over existing, already-RLS'd
 * components/queries — no new source of truth. Mirrors the Prevention hub's
 * pattern (patient/(sections)/prevention/page.tsx): a server page.tsx
 * composing a mix of server (ObesitySummary, BariatricReferralStatus) and
 * client (AtAGlancePanel, ConditionEnrollmentCard, GoalsDialog,
 * WeightEducationFeed) components directly, no monolithic client wrapper.
 *
 * Deliberately mirrors /patient/lifestyle/page.tsx's simpler auth pattern
 * (auth.getUser(), no "acting for" support) rather than
 * getPatientDashboardContext()'s subjectId: the LPE enrollment/log actions
 * (lifestyle/actions.ts) hardcode the signed-in user regardless of which
 * patientId a component is given, so introducing subjectId-based reads here
 * while the writes stayed session-based would silently split a supporter's
 * reads and writes across two different people's records. Matching the
 * existing page's pattern keeps that pre-existing (not new) limitation
 * consistent rather than adding a new mismatch.
 */
export default async function WeightManagementPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const [enrollments, pastGoals, { data: profile }] = await Promise.all([
    getLifestyleState(supabase, user.id),
    getPastLifestyleGoals(supabase, user.id),
    supabase
      .from("profiles")
      .select("condition_language_preference, organisation_id")
      .eq("id", user.id)
      .single(),
  ]);

  const preference = profile?.condition_language_preference;
  const label = obesityLabelTitleCase(preference);
  const obesityEnrollment = enrollments.find((e) => e.conditionKey === "obesity") ?? null;
  const obesityGoals = pastGoals.filter((g) => g.conditionLabel === "Weight & lifestyle");

  return (
    <div className="mx-auto max-w-3xl space-y-6 py-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="flex items-center gap-2 font-heading text-2xl font-semibold text-charcoal-ink">
            <SEMANTIC_ICON.weight className="h-6 w-6 text-deep-forest" strokeWidth={2} />
            {label} management
          </h1>
          <p className="mt-1 text-sm text-charcoal-ink/70">
            Your assessment, your programme, your trackers, and what your care team is doing for
            you — all in one place.
          </p>
        </div>
        {obesityEnrollment && (
          <GoalsDialog enrollments={[obesityEnrollment]} pastGoals={obesityGoals} />
        )}
      </div>

      <ObesitySummary patientId={user.id} conditionLanguagePreference={preference} />

      <AtAGlancePanel patientId={user.id} />

      {obesityEnrollment ? (
        <ConditionEnrollmentCard enrollment={obesityEnrollment} />
      ) : (
        <WeightEnrollCta label={label} />
      )}

      <BariatricReferralStatus patientId={user.id} />

      <WeightEducationFeed patientId={user.id} organisationId={profile?.organisation_id ?? null} />
    </div>
  );
}
