import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { getPatientDashboardContext } from "@/app/(dashboard)/patient/dashboard-context";
import { computeGestationalEstimate } from "@/lib/rules/gestational-age";
import { contraceptionCautionNote, menopauseTreatmentCautionNote, type CarePlanCondition } from "@/lib/rules/womens-health-intersections";
import { Card, CardContent } from "@/components/ui/card";
import { PageHeader } from "@/components/ui/page-header";
import { DashboardSection } from "@/components/ui/dashboard-section";
import { SEMANTIC_ICON } from "@/lib/icons";
import { ReproductiveHealthCard } from "@/app/(dashboard)/patient/reproductive-health-card";
import { ContraceptionCard } from "@/app/(dashboard)/patient/contraception-card";
import { AntenatalCard } from "@/app/(dashboard)/patient/antenatal-card";
import { PregnancyRedFlagCheck } from "@/app/(dashboard)/patient/pregnancy-red-flag-check";
import { PostnatalCard } from "@/app/(dashboard)/patient/postnatal-card";
import { BreastSymptomCard } from "@/app/(dashboard)/patient/breast-symptom-card";
import { MenopauseSymptomCard } from "@/app/(dashboard)/patient/menopause-symptom-card";
import { FertilityRequestCard } from "@/app/(dashboard)/patient/fertility-request-card";
import { formatPatientDate } from "@/lib/format-date";

/**
 * Women's Health (spec §44) — one destination integrating prevention,
 * reproductive health, pregnancy, postnatal and long-term intersecting
 * conditions (§44.16). Only sections relevant to the patient's own
 * self-reported life stage / pregnancy status appear (§44.15) — this page
 * reads reproductive_health_profiles.life_stage and patient_pregnancy as the
 * single source of truth for what to show, the same signal
 * lib/rules/cycle-nudges.ts already keys its nudges on. Breast-health
 * symptom reporting and the fertility/contraception education links appear
 * regardless of life stage — they're relevant at any stage, not tied to one.
 *
 * Cervical/breast *screening* (eligibility, reminders, booking, results,
 * follow-up) already lives in the Prevention hub's screening ladder — not
 * duplicated here; this page links out to it rather than re-implementing it.
 */
export default async function WomensHealthPage() {
  const { profile, subjectId } = await getPatientDashboardContext();

  // Same gate as ReproductiveHealthCard/PreventionHub's Women's Health
  // programme — this whole section is scoped to female patients. Rendered as
  // a friendly gate rather than a redirect: this page is a permanent sidebar
  // link, and the nav contract (lib/navigation.ts) is that gated pages still
  // render a friendly explanation instead of silently bouncing the click.
  // (getPatientDashboardContext already redirects the unauthenticated case.)
  if (profile.sex !== "female") {
    const sexUnrecorded = !profile.sex;
    return (
      <div className="space-y-6">
        <PageHeader
          title="Women's Health"
          icon={SEMANTIC_ICON.family}
          backTo={{ href: "/patient", label: "Dashboard" }}
        />
        <Card variant="soft">
          <CardContent className="space-y-3 py-4 text-sm text-charcoal-ink/70 dark:text-night-ink/70">
            {sexUnrecorded ? (
              <p>
                This section covers cycle tracking, contraception, pregnancy, postnatal care and
                menopause for female patients. We don&apos;t have a sex recorded on your health
                profile yet, so we can&apos;t tell whether it applies to you. You can add it on
                your{" "}
                <Link href="/patient/profile" className="text-brand-green dark:text-brand-green-bright hover:underline">
                  profile
                </Link>{" "}
                and this section will open up if it&apos;s relevant.
              </p>
            ) : (
              <p>
                This section covers cycle tracking, contraception, pregnancy, postnatal care and
                menopause, so it doesn&apos;t apply to your health profile. Everything here is
                built around care that&apos;s specific to female patients.
              </p>
            )}
            <p>
              The screenings and checks that are relevant to you live in{" "}
              <Link href="/patient/prevention" className="text-brand-green dark:text-brand-green-bright hover:underline">
                Prevention
              </Link>
              , built around your own age and history.
            </p>
          </CardContent>
        </Card>
      </div>
    );
  }

  const supabase = await createClient();

  const [{ data: reproProfile }, { data: pregnancy }, { data: activePlans }, { data: nextAppointment }] =
    await Promise.all([
      supabase
        .from("reproductive_health_profiles")
        .select("life_stage, last_period_date, average_cycle_length_days, current_contraception_method")
        .eq("patient_id", subjectId)
        .maybeSingle(),
      supabase
        .from("patient_pregnancy")
        .select("is_pregnant, estimated_due_date, last_menstrual_period_date, high_risk")
        .eq("patient_id", subjectId)
        .maybeSingle(),
      supabase.from("care_plans").select("condition").eq("patient_id", subjectId).eq("status", "active"),
      supabase
        .from("appointments")
        .select("scheduled_for")
        .eq("patient_id", subjectId)
        .neq("status", "cancelled")
        .gte("scheduled_for", new Date().toISOString())
        .order("scheduled_for", { ascending: true })
        .limit(1)
        .maybeSingle(),
    ]);

  const lifeStage = reproProfile?.life_stage ?? "not_applicable";
  const isPregnant = pregnancy?.is_pregnant ?? false;
  const activeConditions = (activePlans ?? []).map((p) => p.condition as CarePlanCondition);
  const gestationalEstimate = isPregnant
    ? computeGestationalEstimate({
        lastMenstrualPeriodDate: pregnancy?.last_menstrual_period_date ?? null,
        estimatedDueDate: pregnancy?.estimated_due_date ?? null,
      })
    : null;

  const showContraception = !isPregnant && lifeStage !== "postpartum";
  const showFertility = lifeStage === "trying_to_conceive";
  const showMenopause = lifeStage === "perimenopausal" || lifeStage === "menopausal";
  const showPostnatal = lifeStage === "postpartum";

  return (
    <DashboardSection
      id="womens-health"
      title="Women's Health"
      description="Prevention, reproductive health, pregnancy, postnatal care and long-term health, in one place."
    >
      <Card>
        <CardContent className="grid grid-cols-2 gap-4 py-4 sm:grid-cols-4">
          <SummaryStat
            label="Cycle"
            value={reproProfile?.last_period_date ? "Tracked" : "Not tracked"}
          />
          {isPregnant && gestationalEstimate && (
            <SummaryStat label="Antenatal" value={`Week ${gestationalEstimate.weeks}`} />
          )}
          <SummaryStat
            label="Next appointment"
            value={
              nextAppointment?.scheduled_for
                ? formatPatientDate(nextAppointment.scheduled_for, {
                    weekday: "short",
                    month: "short",
                    day: "numeric",
                  })
                : "None booked"
            }
          />
        </CardContent>
      </Card>

      {profile.organisation_id && <ReproductiveHealthCard patientId={subjectId} organisationId={profile.organisation_id} />}

      {isPregnant && (
        <>
          <AntenatalCard
            patientId={subjectId}
            lastMenstrualPeriodDate={pregnancy?.last_menstrual_period_date ?? null}
            estimatedDueDate={pregnancy?.estimated_due_date ?? null}
            highRisk={pregnancy?.high_risk ?? false}
          />
          <PregnancyRedFlagCheck patientId={subjectId} />
        </>
      )}

      {showPostnatal && <PostnatalCard patientId={subjectId} />}

      {showContraception && (
        <ContraceptionCard
          initialMethod={reproProfile?.current_contraception_method ?? null}
          cautionNote={contraceptionCautionNote(activeConditions)}
        />
      )}

      {showFertility && <FertilityRequestCard patientId={subjectId} />}

      {showMenopause && <MenopauseSymptomCard patientId={subjectId} />}
      {showMenopause && menopauseTreatmentCautionNote(activeConditions) && (
        <Card>
          <CardContent className="py-4 text-sm text-charcoal-ink/80 dark:text-night-ink/80">
            {menopauseTreatmentCautionNote(activeConditions)}
          </CardContent>
        </Card>
      )}

      <BreastSymptomCard patientId={subjectId} />
    </DashboardSection>
  );
}

function SummaryStat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-xs font-medium uppercase tracking-wide text-charcoal-ink/50 dark:text-night-ink/55">{label}</p>
      <p className="text-sm font-semibold text-charcoal-ink dark:text-night-ink">{value}</p>
    </div>
  );
}
