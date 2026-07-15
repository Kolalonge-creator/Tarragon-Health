import { createClient } from "@/lib/supabase/server";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { MedicationsList } from "@/app/(dashboard)/patient/medications-list";
import { AddMedicationForm } from "@/app/(dashboard)/patient/add-medication-form";
import { VitalsTrendChart } from "@/components/vitals-trend-chart";
import { ScreeningResultForm } from "./screening-result-form";
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

  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-heading text-2xl font-semibold text-charcoal-ink">
          {patient.full_name ?? "Unnamed patient"}
        </h1>
        {patient.phone && <p className="text-charcoal-ink/60">{patient.phone}</p>}
      </div>
      {/* Clinician view is never gated by the patient's own subscription
          tier — refill coordination is a staff-visible clinical detail
          regardless of what the patient's plan does or doesn't unlock for
          them on their own dashboard. */}
      <MedicationsList patientId={patient.id} refillCoordinationEnabled />
      <AddMedicationForm patientId={patient.id} source="clinician" />
      <VitalsTrendChart patientId={patient.id} />
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
