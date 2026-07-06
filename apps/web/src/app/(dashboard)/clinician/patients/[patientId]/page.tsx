import { createClient } from "@/lib/supabase/server";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { MedicationsList } from "@/app/(dashboard)/patient/medications-list";
import { AddMedicationForm } from "@/app/(dashboard)/patient/add-medication-form";

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
    .select("id, full_name, phone")
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
      <MedicationsList patientId={patient.id} />
      <AddMedicationForm patientId={patient.id} source="clinician" />
    </div>
  );
}
