import { createClient, getCurrentUser } from "@/lib/supabase/server";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  LabLiaisonWorklist,
  type LiaisonPatient,
  type RecentUpload,
} from "./liaison-worklist";

/**
 * Lab Liaison Officer dashboard. Labs that don't log into Tarragon email a
 * patient's result to the liaison, who finds the patient here and uploads the
 * document into their record. RLS (private.is_org_staff) is the real gate on
 * both the patient list and the recent-uploads feed — a liaison only ever sees
 * their own organisation's patients and documents.
 */
export default async function LabLiaisonPage() {
  const supabase = await createClient();
  const user = await getCurrentUser();
  if (!user) {
    return null;
  }

  // Org patients the liaison can upload for (RLS-scoped). Capped at 200 for the
  // client-side search; large orgs would move this to server-side search.
  const { data: patientRows } = await supabase
    .from("profiles")
    .select("id, full_name, patient_number, phone")
    .eq("role", "patient")
    .order("full_name", { ascending: true })
    .limit(200);

  const patients: LiaisonPatient[] = (patientRows ?? []).map((p) => ({
    id: p.id,
    fullName: p.full_name,
    patientNumber: p.patient_number,
    phone: p.phone,
  }));

  const { data: recentRows } = await supabase
    .from("lab_result_documents")
    .select(
      "id, source, original_filename, note, created_at, reviewed_at, profiles!lab_result_documents_patient_id_fkey(full_name)",
    )
    .order("created_at", { ascending: false })
    .limit(20);

  const recent: RecentUpload[] = (recentRows ?? []).map((row) => ({
    id: row.id,
    patientName: row.profiles?.full_name ?? null,
    source: row.source,
    originalFilename: row.original_filename,
    note: row.note,
    createdAt: row.created_at,
    reviewed: row.reviewed_at != null,
  }));

  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-heading text-2xl font-semibold text-charcoal-ink">Lab liaison</h1>
        <p className="text-charcoal-ink/60">
          Upload patient results emailed to Tarragon by partner labs.
        </p>
      </div>
      {patients.length === 0 ? (
        <Card>
          <CardHeader>
            <CardTitle>No patients yet</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-sm text-charcoal-ink/60">
              There are no patients in your organisation to upload results for yet.
            </p>
          </CardContent>
        </Card>
      ) : (
        <LabLiaisonWorklist patients={patients} recent={recent} />
      )}
    </div>
  );
}
