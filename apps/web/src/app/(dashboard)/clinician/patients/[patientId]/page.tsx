import { createClient } from "@/lib/supabase/server";
import { getCurrentClinicalStaff } from "@/lib/auth/current-profile";
import { hasPrescribingAuthority } from "@/lib/clinical/doctor-tier";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { MedicationsList } from "@/app/(dashboard)/patient/medications-list";
import { AddMedicationForm } from "@/app/(dashboard)/patient/add-medication-form";
import { VitalsTrendChart } from "@/components/vitals-trend-chart";
import { PatientTimeline } from "@/components/patient-timeline";
import { ScreeningResultForm } from "./screening-result-form";
import { ResultDocumentsSection } from "./result-documents-section";
import { CareTeamForm } from "./care-team-form";
import { OrderLabTestForm } from "./order-lab-test-form";

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
    .select("id, full_name, phone, organisation_id")
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

  const callerStaff = await getCurrentClinicalStaff();
  const canPrescribe = hasPrescribingAuthority(callerStaff);
  // Tier 1's other half of the job (master plan §4/§8): confirm/continue an
  // existing prescription without prescribing authority. Never Tier 2+/
  // Director — they already get the unrestricted AddMedicationForm above.
  const canConfirmRefill = !canPrescribe && callerStaff?.doctor_tier === "tier_1";

  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-heading text-2xl font-semibold text-charcoal-ink">
          {patient.full_name ?? "Unnamed patient"}
        </h1>
        {patient.phone && <p className="text-charcoal-ink/60">{patient.phone}</p>}
      </div>
      <PatientTimeline patientId={patient.id} />
      {/* Clinician view is never gated by the patient's own subscription
          tier — refill coordination is a staff-visible clinical detail
          regardless of what the patient's plan does or doesn't unlock for
          them on their own dashboard. */}
      <MedicationsList
        patientId={patient.id}
        refillCoordinationEnabled
        canConfirmRefill={canConfirmRefill}
      />
      {/* Pharmacy-authority-by-tier (master plan §4/§8): Tier 1 confirms/
          continues existing prescriptions but has no new-prescribing
          authority — the DB RLS policy is the real gate
          (private.has_prescribing_authority), this just explains it
          instead of surfacing a raw RLS error. */}
      {canPrescribe ? (
        <AddMedicationForm patientId={patient.id} source="clinician" />
      ) : (
        <Card>
          <CardHeader>
            <CardTitle>Add a medication</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-sm text-charcoal-ink/60">
              Tier 1 doctors confirm and continue existing stable prescriptions under protocol —
              starting a new medication needs a Tier 2+ doctor or the Clinical Director. Use
              &quot;Confirm &amp; continue&quot; on a prescribed medication above to extend its refill
              date.
            </p>
          </CardContent>
        </Card>
      )}
      <VitalsTrendChart patientId={patient.id} />
      <ResultDocumentsSection patientId={patient.id} />
      <ScreeningResultForm patientId={patient.id} />
      {patient.organisation_id && (
        <>
          <CareTeamForm patientId={patient.id} organisationId={patient.organisation_id} />
          <OrderLabTestForm patientId={patient.id} organisationId={patient.organisation_id} />
        </>
      )}
    </div>
  );
}
