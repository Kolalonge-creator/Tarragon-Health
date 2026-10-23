import Link from "next/link";
import { ageFromDateOfBirth } from "@tarragon/shared";
import { t } from "@tarragon/i18n";
import { readProvenanceGuards } from "@/lib/diary/guards";
import { getPatientDashboardContext } from "@/app/(dashboard)/patient/dashboard-context";
import { DashboardSection } from "@/components/ui/dashboard-section";
import { SEMANTIC_ICON } from "@/lib/icons";
import { VitalsForm } from "@/app/(dashboard)/patient/vitals-form";
import { LifestyleLogCard } from "@/app/(dashboard)/patient/lifestyle-log-card";
import { InhalerHistory } from "@/app/(dashboard)/patient/inhaler-history";
import { createClient } from "@/lib/supabase/server";
import { readExtendedObservationsEnabled } from "@/lib/vitals/extended-observations";
import { MonitoringCoverCard } from "@/components/monitoring-cover-card";
import { HbpmSummaryCard } from "@/app/(dashboard)/patient/hbpm-summary-card";
import { GlucoseInsights } from "@/app/(dashboard)/patient/glucose-insights";
import { VitalsHistory } from "@/app/(dashboard)/patient/vitals-history";
import { HeldReadingsCard } from "@/app/(dashboard)/patient/held-readings-card";
import { VitalsTrendChart } from "@/components/vitals-trend-chart";
import { AgpCard } from "@/components/agp-card";
import { SymptomLogForm } from "@/app/(dashboard)/patient/symptom-log-form";
import { SymptomLogHistory } from "@/app/(dashboard)/patient/symptom-log-history";
import { FeatureConsentGate } from "@/components/consent/feature-consent-gate";
import { WearableConnectSection } from "@/app/(dashboard)/patient/wearable-connect-section";
import { SleepSummaryCard } from "@/app/(dashboard)/patient/sleep-summary-card";
import { DiabetesDailyLog } from "@/app/(dashboard)/patient/diabetes-daily-log";
import { DeviceSyncSupportCard } from "@/app/(dashboard)/patient/device-sync-support-card";
import { GrowthTrackingCard } from "@/app/(dashboard)/patient/growth-tracking-card";
import { SymptomTriageCheck } from "@/app/(dashboard)/patient/symptom-triage-check";
import { getSymptomCheckerEligibility, getSymptomReviewEntitled, getSymptomReviewTime, listAvailablePresentingComplaints } from "@/app/(dashboard)/patient/symptom-triage-actions";
import { degradedModeConfig } from "@/lib/symptom-triage/safe-run";
import { ComplicationStatus } from "@/app/(dashboard)/patient/complication-status";
import { FootRiskStatus } from "@/app/(dashboard)/patient/foot-risk-status";
import { ThresholdOverrideNotice } from "@/app/(dashboard)/patient/threshold-override-notice";
import { WeeklySummaryCard } from "@/app/(dashboard)/patient/weekly-summary-card";
import { VisitReportCard } from "@/app/(dashboard)/patient/visit-report-card";

export default async function PatientVitalsPage() {
  const { profile, subjectId, subjectDateOfBirth, glucoseUnit } = await getPatientDashboardContext();
  const ageYears = ageFromDateOfBirth(subjectDateOfBirth);
  // S07y: the pharmacy label and the paper diary are born off; the form and the link only appear once the guard is open for this person.
  const guards = await readProvenanceGuards(await createClient());
  // S47a: water, sleep, mood and inhaler logs show only while the extended_observations module is on (born off).
  const extendedObservationsOn = await readExtendedObservationsEnabled(await createClient());
  const presentingComplaints = await listAvailablePresentingComplaints();
  // The stated review time is read from the signed SLA only when the checker is open (nothing to promise otherwise).
  const reviewTime = presentingComplaints.length > 0 ? await getSymptomReviewTime() : ({ stated: false } as const);
  // S59b: who the checker is for must be an adult with a date of birth; a clinician's look at a check is for Members.
  const eligibility = presentingComplaints.length > 0 ? await getSymptomCheckerEligibility() : ("ok" as const);
  const reviewEntitled = presentingComplaints.length > 0 ? await getSymptomReviewEntitled() : false;

  return (
    <DashboardSection
      id="vitals"
      title="Vitals & symptoms"
      description="Log readings and symptoms, and see how they trend over time."
      icon={SEMANTIC_ICON.bp}
    >
      {subjectId === profile.id ? <ThresholdOverrideNotice /> : null}
      <VitalsTrendChart patientId={subjectId} />
      {/* Renders nothing until there is sensor glucose to show. */}
      <AgpCard patientId={subjectId} audience="patient" />
      <WeeklySummaryCard patientId={subjectId} glucoseUnit={glucoseUnit} />

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        {/* Directly above the form someone logs a reading into, which is the
            one moment they are actually thinking about what happens to it. */}
        <MonitoringCoverCard />

        <VitalsForm patientId={subjectId} pharmacyOpen={guards.pharmacyOpen} />
        <div className="space-y-4">
          <HbpmSummaryCard patientId={subjectId} />
          <GlucoseInsights patientId={subjectId} />
        </div>
      </div>

      {extendedObservationsOn ? <LifestyleLogCard types={["water_ml", "sleep_hours", "mood", "inhaler_use"]} /> : null}
      {extendedObservationsOn ? <InhalerHistory patientId={subjectId} /> : null}
      {guards.diaryEntryOpen && (
        <p className="text-sm">
          <Link href="/patient/diary" className="font-medium underline" data-testid="diary-entry-link">
            {t("diary.entry_link")}
          </Link>
          <span className="ml-2 text-charcoal-ink/60 dark:text-night-ink/60">{t("diary.entry_link_hint")}</span>
        </p>
      )}

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <SymptomLogForm patientId={subjectId} ageYears={ageYears} />
        <SymptomLogHistory patientId={subjectId} />
      </div>

      {/* Renders nothing once the subject is old enough that a paediatric
          growth chart no longer applies — see growth-tracking-card.tsx. */}
      <GrowthTrackingCard
        patientId={subjectId}
        organisationId={profile.organisation_id}
        ageYears={ageYears}
      />
      <div id="symptom-check" className="scroll-mt-24">
        <SymptomTriageCheck
          patientId={subjectId}
          presentingComplaints={presentingComplaints}
          degradedConfig={degradedModeConfig()}
          reviewTime={reviewTime}
          eligibility={eligibility}
          reviewEntitled={reviewEntitled}
        />
      </div>

      {/* Renders nothing unless a value that cannot be real is waiting for the person to check it (S70a). */}
      <HeldReadingsCard patientId={subjectId} />
      <VitalsHistory patientId={subjectId} viewerId={profile.id} />
      <VisitReportCard />
      {/* Renders nothing unless the patient has an active diabetes care
          plan — see diabetes-daily-log.tsx for the gate. */}
      <DiabetesDailyLog patientId={subjectId} />
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <ComplicationStatus patientId={subjectId} />
        <FootRiskStatus patientId={subjectId} />
      </div>
      {/* Renders nothing until a connected wearable has synced at least one
          night — see sleep-summary-card.tsx. */}
      <SleepSummaryCard patientId={subjectId} />
      {/* id target for the Privacy Centre's "Manage device connections" link
          (/patient/vitals#connect-devices) — that link used to land here at
          the top of Vitals with no scroll-to, which read as broken. */}
      <div id="connect-devices">
        <FeatureConsentGate dataType="device_data" onBehalfOf={subjectId !== profile.id}>
          <WearableConnectSection patientId={subjectId} />
        </FeatureConsentGate>
      </div>
      <DeviceSyncSupportCard patientId={subjectId} />
    </DashboardSection>
  );
}
