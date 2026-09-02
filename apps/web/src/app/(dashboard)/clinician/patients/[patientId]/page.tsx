import { createClient, getCurrentUser } from "@/lib/supabase/server";
import { getCurrentClinicalStaff } from "@/lib/auth/current-profile";
import {
  canConfirmMedicationRefill,
  hasPrescribingAuthority,
  isClinicalTier,
} from "@/lib/clinical/doctor-tier";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { MaskedCallButton } from "@/components/masked-call-button";
import { MedicationsList } from "@/app/(dashboard)/patient/medications-list";
import { AddMedicationForm } from "@/app/(dashboard)/patient/add-medication-form";
import { VitalsTrendChart } from "@/components/vitals-trend-chart";
import { LipidProfileCard } from "@/components/patient/lipid-profile-card";
import { PatientTimeline } from "@/components/patient-timeline";
import { MentalHealthSummary } from "@/components/mental-health-summary";
import { PreVisitSummary } from "./pre-visit-summary";
import { ScreeningResultForm } from "./screening-result-form";
import { ScreenOrderResultsSection } from "./screen-order-results-section";
import { ResultDocumentsSection } from "./result-documents-section";
import { EcgReportDocumentsSection } from "./ecg-report-documents-section";
import { MedicationSafetyPanel } from "./medication-safety-panel";
import { MedicationReconciliationPanel } from "./medication-reconciliation-panel";
import { MedicationEffectivenessCard } from "@/components/medication-effectiveness-card";
import { MedicationRepeatRequestsPanel } from "./medication-repeat-requests-panel";
import { BloodProfileForm } from "./blood-profile-form";
import { HealthTrendsCard } from "@/components/patient/health-trends-card";
import { CareTeamForm } from "./care-team-form";
import { HandOverCareSection } from "./hand-over-care-section";
import { OrderLabTestForm } from "./order-lab-test-form";
import { BpLadderPanel } from "./bp-ladder-panel";
import { CardiovascularRiskPanel } from "./cardiovascular-risk-panel";
import { loadCvRiskAssessment } from "@/lib/cv-risk/assess";
import { FootAssessmentForm } from "./foot-assessment-form";
import { ComplicationCheckForm } from "./complication-check-form";
import { GlucoseTargetForm } from "./glucose-target-form";
import { DiabetesTypeForm } from "./diabetes-type-form";
import { TreatmentLadder } from "./treatment-ladder";
import { ObesityAssessmentPanel } from "./obesity-assessment-panel";
import { ObesityEdScreenForm } from "./obesity-ed-screen-form";
import { ObesityAttestationCard } from "./obesity-attestation-card";
import { HealthCheckReview } from "./health-check-review";
import { HealthCheckVideoConsult } from "./health-check-video-consult";
import { CarePlanManagementSection } from "./care-plan-management-section";
import { ChronicProgrammeReviewSection } from "./chronic-programme-review-section";
import { ClinicalEncounterNotesSection } from "./clinical-encounter-notes-section";
import { CreateReferralForm } from "./create-referral-form";
import { PatientReferralsList } from "./patient-referrals-list";
import { PatientRecordTabs, type PatientRecordTab } from "./patient-record-tabs";

export default async function ClinicianPatientPage({
  params,
}: {
  params: Promise<{ patientId: string }>;
}) {
  const { patientId } = await params;
  const supabase = await createClient();

  // RLS (private.is_org_staff) is the real gate here: a patient outside the
  // caller's org simply doesn't come back, same as any other cross-tenant
  // lookup in this app.
  const { data: patient } = await supabase
    .from("profiles")
    .select("id, full_name, phone, organisation_id, sex, date_of_birth")
    .eq("id", patientId)
    .eq("role", "patient")
    .maybeSingle();

  if (!patient) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Patient not found</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-charcoal-ink/60">
            This patient doesn&apos;t exist or isn&apos;t in your organisation.
          </p>
        </CardContent>
      </Card>
    );
  }

  // Read-access audit: a trigger can log who changed a patient row, but not who merely
  // opened it — this is the one explicit read-logging call site on the platform so far
  // (see 20260812034612_clinician_patient_record_view_audit.sql). Best-effort: a logging
  // failure must never block the clinician from seeing the chart.
  const { error: viewLogError } = await supabase.rpc("log_patient_record_view", {
    p_patient_id: patient.id,
  });
  if (viewLogError) {
    console.error("Failed to log patient record view", viewLogError);
  }

  const callerStaff = await getCurrentClinicalStaff();
  const canPrescribe = hasPrescribingAuthority(callerStaff);
  const currentUser = await getCurrentUser();
  // Pregnancy context for the drug-safety advisory (§20.2).
  const { data: pregnancy } = await supabase
    .from("patient_pregnancy")
    .select("is_pregnant")
    .eq("patient_id", patientId)
    .maybeSingle();
  const isPregnant = pregnancy?.is_pregnant ?? false;

  // Diabetes type: patient's own self-report, shown to the confirming
  // clinician as context (never trusted as the authoritative record — see
  // diabetes-type-form.tsx).
  const { data: diabetesProfile } = await supabase
    .from("patient_diabetes_profile")
    .select("patient_reported_type")
    .eq("patient_id", patientId)
    .maybeSingle();

  // Current-year Health Check status for the "Review & communicate" control.
  const year = new Date().getFullYear();
  const { data: healthCheck } = await supabase
    .from("annual_health_checks")
    .select(
      "reviewed_at, reviewed_by, video_consult:video_consultations!annual_health_checks_video_consultation_id_fkey(id, proposed_slots, scheduled_at)"
    )
    .eq("patient_id", patientId)
    .eq("year", year)
    .maybeSingle();
  let reviewedByName: string | null = null;
  if (healthCheck?.reviewed_by) {
    const { data: reviewer } = await supabase
      .from("clinical_staff")
      .select("full_name, credential_type, credential_number")
      .eq("id", healthCheck.reviewed_by)
      .maybeSingle();
    if (reviewer) {
      reviewedByName = [
        `Dr. ${reviewer.full_name}`,
        reviewer.credential_type && reviewer.credential_number
          ? `${reviewer.credential_type} ${reviewer.credential_number}`
          : null,
      ]
        .filter(Boolean)
        .join(" · ");
    }
  }
  // Confirm/continue an existing prescription (master plan §4/§8) —
  // characteristically Tier 1's half of the job, but NOT Tier-1-exclusive.
  // Clinical authority is monotonic, so a senior doctor covering a shift with
  // no Tier 1 on duty must be able to do this too. The previous
  // `!canPrescribe` exclusion made it unreachable for them: AddMedicationForm
  // adds a new medication and StopMedication stops one, so neither is a
  // substitute for moving an existing medication's refill date.
  const canConfirmRefill = canConfirmMedicationRefill(callerStaff);

  // Cardiovascular-risk assessment (lipids as one input to total CV risk) +
  // the patient's recorded CV history, for the CardiovascularRiskPanel.
  const cvAssessment = patient.organisation_id
    ? await loadCvRiskAssessment(supabase, patient.id, patient.organisation_id)
    : null;
  const { data: cvProfile } = await supabase
    .from("patient_cardiovascular_profile")
    .select(
      "established_ascvd, prior_mi, prior_stroke_tia, prior_pad, prior_revascularisation, familial_hypercholesterolaemia, notes"
    )
    .eq("patient_id", patient.id)
    .maybeSingle();

  const { data: bloodProfile } = await supabase
    .from("patient_blood_profile")
    .select("blood_group, genotype, genotype_note, provenance, document_id, attested_at, recorded_at")
    .eq("patient_id", patient.id)
    .maybeSingle();

  // The reports a blood group or genotype may be recorded AGAINST. With none on
  // file the form offers no way to type one in on trust — that is the point.
  const { data: bloodReports } = await supabase
    .from("lab_result_documents")
    .select("id, original_filename, created_at")
    .eq("patient_id", patient.id)
    .order("created_at", { ascending: false })
    .limit(25);

  const tabs: PatientRecordTab[] = [
          {
            id: "overview",
            label: "Overview",
            content: (
              <>
                <PreVisitSummary
                  patientId={patient.id}
                  sex={patient.sex}
                  dateOfBirth={patient.date_of_birth}
                />
                {/* Two facts with outsized weight in a Nigerian emergency, and
                    the platform had nowhere to keep them until now. */}
                <BloodProfileForm
                  patientId={patient.id}
                  initial={
                    bloodProfile
                      ? {
                          bloodGroup: bloodProfile.blood_group,
                          genotype: bloodProfile.genotype,
                          genotypeNote: bloodProfile.genotype_note,
                          provenance: bloodProfile.provenance,
                          documentId: bloodProfile.document_id,
                          attestedAt: bloodProfile.attested_at,
                          recordedAt: bloodProfile.recorded_at,
                        }
                      : null
                  }
                  reports={(bloodReports ?? []).map((r) => ({
                    id: r.id,
                    label: `${r.original_filename ?? "Result"} · ${new Date(
                      r.created_at,
                    ).toLocaleDateString("en-GB", {
                      day: "numeric",
                      month: "short",
                      year: "numeric",
                    })}`,
                  }))}
                />
                <PatientTimeline patientId={patient.id} />
                {patient.organisation_id && (
                  <CareTeamForm patientId={patient.id} organisationId={patient.organisation_id} />
                )}
                <HandOverCareSection patientId={patient.id} />
              </>
            ),
          },
          {
            id: "medications",
            label: "Medications",
            content: (
              <>
                {/* Clinician view is never gated by the patient's own subscription
                    tier — refill coordination is a staff-visible clinical detail
                    regardless of what the patient's plan does or doesn't unlock for
                    them on their own dashboard. */}
                {/* Above the list deliberately: the interaction, duplicate-therapy
                    and renal-dosing checks are what a dispensing pharmacist would
                    have caught, and this platform has no pharmacist in the loop. */}
                <MedicationSafetyPanel patientId={patient.id} />
                <MedicationEffectivenessCard patientId={patient.id} />
                <MedicationReconciliationPanel patientId={patient.id} />
                {/* Spec §62.12 — every repeat request needs a clinician's
                    decision; canReview mirrors canConfirmRefill (any active
                    clinical tier, never a Care Coordinator) since approving a
                    routine repeat is that same class of act. */}
                <MedicationRepeatRequestsPanel patientId={patient.id} canReview={canConfirmRefill} />
                <MedicationsList
                  patientId={patient.id}
                  refillCoordinationEnabled
                  canConfirmRefill={canConfirmRefill}
                  canAmend={canPrescribe}
                  isClinicianView
                />
                {/* Pharmacy-authority-by-tier (master plan §4/§8): Tier 1 confirms/
                    continues existing prescriptions but has no new-prescribing
                    authority — the DB RLS policy is the real gate
                    (private.has_prescribing_authority), this just explains it
                    instead of surfacing a raw RLS error. */}
                {canPrescribe ? (
                  <AddMedicationForm patientId={patient.id} source="clinician" pregnant={isPregnant} />
                ) : (
                  <Card>
                    <CardHeader>
                      <CardTitle>Add a medication</CardTitle>
                    </CardHeader>
                    <CardContent>
                      <p className="text-sm text-charcoal-ink/60">
                        Tier 1 doctors confirm and continue existing stable prescriptions under
                        protocol; starting a new medication needs a Tier 2+ doctor or the Clinical
                        Director. Use &quot;Confirm &amp; continue&quot; on a prescribed medication
                        above to extend its refill date.
                      </p>
                    </CardContent>
                  </Card>
                )}
                <TreatmentLadder />
              </>
            ),
          },
          {
            id: "care-plan",
            label: "Care plan",
            content: patient.organisation_id ? (
              <CarePlanManagementSection patientId={patient.id} organisationId={patient.organisation_id} />
            ) : (
              <p className="text-sm text-charcoal-ink/60">This patient has no organisation on file.</p>
            ),
          },
          {
            id: "chronic-programme",
            label: "12-week programme",
            content: <ChronicProgrammeReviewSection patientId={patient.id} />,
          },
          {
            id: "vitals-chronic-care",
            label: "Vitals & chronic care",
            content: (
              <>
                <BpLadderPanel patientId={patient.id} />
                <HealthTrendsCard patientId={patient.id} audience="clinician" />
                <VitalsTrendChart patientId={patient.id} />
                <LipidProfileCard patientId={patient.id} />
                <CardiovascularRiskPanel
                  patientId={patient.id}
                  assessment={cvAssessment}
                  initialProfile={cvProfile ?? null}
                />
                {/* Foot-risk classification is a clinical act — only an active
                    clinical_staff member (not a Care Coordinator) sees the form.
                    isClinicalTier, not a bare callerStaff truthy check: Care
                    Coordinators carry an active clinical_staff row too
                    (doctor_tier = 'care_coordinator'), so `callerStaff &&` alone
                    no longer excludes them. */}
                {isClinicalTier(callerStaff) && <GlucoseTargetForm patientId={patient.id} />}
                {isClinicalTier(callerStaff) && (
                  <DiabetesTypeForm
                    patientId={patient.id}
                    patientReportedType={diabetesProfile?.patient_reported_type ?? null}
                  />
                )}
                {isClinicalTier(callerStaff) && <FootAssessmentForm patientId={patient.id} />}
                {isClinicalTier(callerStaff) && <ComplicationCheckForm patientId={patient.id} />}
              </>
            ),
          },
          {
            id: "screening-prevention",
            label: "Screening & prevention",
            content: (
              <>
                {/* Each uploaded document carries its own read-and-file panel
                    inline, so checking a value against the page is one glance. */}
                <ResultDocumentsSection patientId={patient.id} />
                <EcgReportDocumentsSection patientId={patient.id} />
                <MentalHealthSummary patientId={patient.id} showScores />
                <ScreenOrderResultsSection patientId={patient.id} />
                <ScreeningResultForm patientId={patient.id} />
                <HealthCheckVideoConsult consult={healthCheck?.video_consult ?? null} />
                <HealthCheckReview
                  patientId={patient.id}
                  reviewedAt={healthCheck?.reviewed_at ?? null}
                  reviewedByName={reviewedByName}
                />
                {patient.organisation_id && (
                  <OrderLabTestForm patientId={patient.id} organisationId={patient.organisation_id} />
                )}
                {/* Obesity pathway (TH-CP-OB-001): attestation gate, structured
                    assessment (classification + staging + screens), and the
                    mandatory ED/mental-health screen that auto-pauses weight-loss
                    on a positive. */}
                <ObesityAttestationCard />
                <ObesityAssessmentPanel patientId={patient.id} patientSex={patient.sex} />
                <ObesityEdScreenForm patientId={patient.id} />
              </>
            ),
          },
          {
            id: "clinical-notes",
            label: "Clinical notes",
            content: patient.organisation_id ? (
              <ClinicalEncounterNotesSection
                patientId={patient.id}
                organisationId={patient.organisation_id}
                canWrite={isClinicalTier(callerStaff)}
                canActionFollowUps={Boolean(callerStaff)}
                patientName={patient.full_name ?? "this patient"}
                patientDateOfBirth={patient.date_of_birth}
              />
            ) : null,
          },
          {
            id: "referrals",
            label: "Referrals",
            content: (
              <>
                <PatientReferralsList patientId={patient.id} />
                {/* Creating a referral is a clinical decision (67.2/67.7) —
                    gated to clinical tier here to match the DB create-gate
                    trigger (private.is_clinical_tier), same isClinicalTier
                    pattern the vitals/diabetes forms above already use. */}
                {patient.organisation_id && isClinicalTier(callerStaff) ? (
                  <CreateReferralForm patientId={patient.id} organisationId={patient.organisation_id} />
                ) : (
                  <p className="text-sm text-charcoal-ink/60">
                    Only a clinical-tier member of the care team can create a specialist referral.
                  </p>
                )}
              </>
            ),
          },
        ];

  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-heading text-2xl font-semibold text-charcoal-ink">
          {patient.full_name ?? "Unnamed patient"}
        </h1>
        {patient.phone && <p className="text-charcoal-ink/60">{patient.phone}</p>}
        {currentUser && (
          <div className="mt-2">
            <MaskedCallButton
              patientId={patient.id}
              staffProfileId={currentUser.id}
              otherPartyLabel="this patient"
              context="clinical_follow_up"
            />
          </div>
        )}
      </div>
      <PatientRecordTabs tabs={tabs} />
    </div>
  );
}
