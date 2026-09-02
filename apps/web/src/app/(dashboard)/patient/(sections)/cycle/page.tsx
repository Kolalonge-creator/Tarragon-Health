import type { Metadata } from "next";
import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { getPatientDashboardContext } from "@/app/(dashboard)/patient/dashboard-context";
import { DashboardSection } from "@/components/ui/dashboard-section";
import { SEMANTIC_ICON } from "@/lib/icons";
import { CycleTracker } from "@/app/(dashboard)/patient/cycle/cycle-tracker";
import type { ReproductiveLifeStage } from "@/lib/rules/cycle-prediction";

export const metadata: Metadata = {
  title: "Your cycle",
};

/**
 * The cycle tracker's own route, rather than a card inside the Prevention
 * hub.
 *
 * It used to be a single card there holding a life-stage dropdown and one
 * line of text ("estimated next period around <date>"). That was the whole
 * feature. Somebody tracking a cycle opens it most days of the month, needs
 * a calendar and a place to log how they feel, and is doing something quite
 * separate from booking a screening — so it earns a page. The Prevention hub
 * keeps a summary card at #cycle that links here, and life stage stays on
 * that card since it also drives the pregnancy and menopause nudges, which
 * are not cycle tracking.
 *
 * Deliberately NOT added to lib/navigation.ts: the sidebar is a flat list
 * shown to every patient, and a permanent "Cycle" entry for everybody is
 * worse than the two relevance-gated doors this already has (the Prevention
 * card and the feature registry, which surfaces it for a search like
 * "period"). Reaching this URL directly always works, for the same reason
 * isFeatureRelevant is permissive about unrecorded signals: a blank `sex`
 * column is a gap in our record, not a statement about the patient.
 */
export default async function CyclePage() {
  const { profile, subjectId } = await getPatientDashboardContext();

  const supabase = await createClient();
  const { data: reproductiveProfile } = await supabase
    .from("reproductive_health_profiles")
    .select("life_stage, average_cycle_length_days")
    .eq("patient_id", subjectId)
    .maybeSingle();

  const lifeStage: ReproductiveLifeStage = reproductiveProfile?.life_stage ?? "menstruating";

  return (
    <DashboardSection
      id="cycle"
      title="Your cycle"
      description="Log your period and how you feel, and see what to expect next. Everything here is an estimate from your own history, never a diagnosis."
      icon={SEMANTIC_ICON.family}
    >
      {/* Every row written here carries an organisation_id, so without one
          there is nothing to write to. Same guard the Prevention hub puts
          around this card. */}
      {profile.organisation_id ? (
        <CycleTracker
          patientId={subjectId}
          organisationId={profile.organisation_id}
          lifeStage={lifeStage}
          selfReportedCycleLengthDays={reproductiveProfile?.average_cycle_length_days ?? null}
        />
      ) : (
        <p className="text-sm text-charcoal-ink/70">
          We need to finish setting up your account before you can track your cycle. Please
          contact your care team.
        </p>
      )}

      <p className="text-sm text-charcoal-ink/70">
        Trying to conceive, pregnant, postpartum or approaching menopause?{" "}
        <Link href="/patient/prevention#cycle" className="font-medium text-brand-green underline">
          Set your life stage in Prevention
        </Link>{" "}
        so the guidance here matches where you are.
      </p>
    </DashboardSection>
  );
}
