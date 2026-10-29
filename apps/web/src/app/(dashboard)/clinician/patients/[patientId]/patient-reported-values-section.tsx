import { createClient } from "@/lib/supabase/server";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { displayCode } from "@/lib/biomarkers/trend";

function formatDate(value: string): string {
  return new Date(value).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "Africa/Lagos" });
}

/**
 * The numbers a patient confirmed from a report they uploaded themselves (patient_reported_lab_values). A patient with no doctor time
 * (the free plan) can still put their own results on their own chart this way; this is where the care team sees them. They are NOT
 * part of the clinical record and are never mixed into the doctor-facing results above: no flag, no range, labelled as the patient's own.
 * Filing the report in the usual way (the read-and-file panel on the document) puts the values in the record, and from then on the
 * patient's copy is hidden here so nothing appears twice. Only rows the caller may read come back (the row policy is the gate), so a
 * doctor with no tie to the patient and no opened record sees nothing.
 */
export async function PatientReportedValuesSection({ patientId }: { patientId: string }) {
  const supabase = await createClient();
  const { data: rows } = await supabase
    .from("patient_reported_lab_values")
    .select("id, code, value, unit, taken_at, extraction_id, document_id")
    .eq("patient_id", patientId)
    .order("taken_at", { ascending: false })
    .limit(200);
  if (!rows || rows.length === 0) return null;

  // A report a doctor has since filed shows through the clinical record instead.
  const extractionIds = [...new Set(rows.map((r) => r.extraction_id))];
  const { data: filed } = await supabase.from("lab_report_extractions").select("id, status").in("id", extractionIds).eq("status", "confirmed");
  const filedIds = new Set((filed ?? []).map((e) => e.id));
  const open = rows.filter((r) => !filedIds.has(r.extraction_id));
  if (open.length === 0) return null;

  const documentIds = [...new Set(open.map((r) => r.document_id))];
  const { data: docs } = await supabase.from("lab_result_documents").select("id, original_filename").in("id", documentIds);
  const fileName = new Map((docs ?? []).map((d) => [d.id, d.original_filename] as const));

  return (
    <Card data-testid="patient-reported-values">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          Confirmed by the patient
          <Badge variant="amber">Not checked by a doctor</Badge>
        </CardTitle>
        <CardDescription>
          The patient checked these numbers against their own report. They are not in the clinical record. Open the report above and file it to
          put them there.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs text-charcoal-ink/60">
                <th className="py-1 pr-3 font-medium">Report date</th>
                <th className="py-1 pr-3 font-medium">Test</th>
                <th className="py-1 pr-3 font-medium">Number</th>
                <th className="py-1 font-medium">From</th>
              </tr>
            </thead>
            <tbody>
              {open.map((r) => (
                <tr key={r.id} className="border-t border-charcoal-ink/10">
                  <td className="py-1 pr-3">{formatDate(r.taken_at)}</td>
                  <td className="py-1 pr-3">{displayCode(r.code)}</td>
                  <td className="py-1 pr-3">
                    {r.value}
                    {r.unit ? ` ${r.unit}` : ""}
                  </td>
                  <td className="py-1">{fileName.get(r.document_id) ?? "Uploaded report"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </CardContent>
    </Card>
  );
}
