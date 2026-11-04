import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { openPatientRecord } from "@/lib/clinical/open-patient-record";
import { formatPatientDate } from "@/lib/format-date";
import { PageHeader } from "@/components/ui/page-header";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { loadRecordItems, PATIENT_STATUS, PIPELINE_GROUP, previousOfSameKind } from "@/lib/clinical-documents/record-items";

export const metadata = { title: "Document" };
export const dynamic = "force-dynamic";

/** Where each kind of document is read and filed on the patient record. */
const WHERE_TO_ACT: Record<string, { tab: string; label: string }> = {
  lab_result_documents: { tab: "screening-prevention", label: "Read and file it under Screening & prevention" },
  lab_result_files: { tab: "screening-prevention", label: "Review the result under Screening & prevention" },
  ecg_report_documents: { tab: "screening-prevention", label: "Read the ECG under Screening & prevention" },
  imaging_report_documents: { tab: "screening-prevention", label: "Review the scan under Screening & prevention" },
};

/**
 * The side-by-side viewer (clinical document engine step 6): the original on one side, the facts of the document and the earlier
 * ones of the same kind on the other, and a link to where it is read or filed. Opening it opens the patient's record, which is
 * logged (S39c), exactly as the patient page does; nothing is shown if the opening cannot be recorded.
 */
export default async function RecordDocumentPage({ params }: { params: Promise<{ patientId: string; documentId: string }> }) {
  const { patientId, documentId } = await params;
  const supabase = await createClient();
  const opened = await openPatientRecord(supabase, patientId);
  if (opened.status === "failed") {
    return <p className="text-sm text-red-700">The opening could not be recorded, so the document is not shown. Try again in a moment.</p>;
  }
  const items = await loadRecordItems(supabase, patientId, { sign: { only: documentId } });
  const doc = items.find((i) => i.id === documentId);
  if (!doc) return <p className="text-sm">This document is not on a record you can open.</p>;
  const earlier = previousOfSameKind(items, doc);
  const act = doc.routed_table ? WHERE_TO_ACT[doc.routed_table] : { tab: "screening-prevention", label: "Review it under Screening & prevention (Uploaded documents not yet read automatically)" };
  const isImage = (doc.mime_type ?? "").startsWith("image/");

  return (
    <div className="space-y-4">
      <PageHeader
        backTo={{ href: `/clinician/patients/${patientId}?tab=records`, label: "Records and investigations" }}
        title={doc.kind_label ?? "Document not yet sorted"}
        description={`${PIPELINE_GROUP[doc.pipeline ?? "unsorted"] ?? doc.pipeline} · added ${formatPatientDate(doc.uploaded_at ?? "")}`}
      />
      <div className="grid gap-4 lg:grid-cols-[3fr_2fr]">
        <Card>
          <CardHeader><CardTitle>Original</CardTitle></CardHeader>
          <CardContent>
            {doc.signedUrl ? (
              isImage ? (
                // eslint-disable-next-line @next/next/no-img-element -- a short-lived signed URL; next/image would proxy and cache it
                <img src={doc.signedUrl} alt={`Original ${doc.kind_label ?? "document"}`} className="max-h-[80vh] w-full object-contain" />
              ) : (
                <iframe src={doc.signedUrl} title={`Original ${doc.kind_label ?? "document"}`} className="h-[80vh] w-full rounded border" />
              )
            ) : (
              <p className="text-sm text-charcoal-ink/60">{doc.routed_table === "lab_result_files" ? "This laboratory file opens from its result." : "The file could not be opened just now."}</p>
            )}
          </CardContent>
        </Card>
        <div className="space-y-4">
          <Card>
            <CardHeader><CardTitle>About this document</CardTitle></CardHeader>
            <CardContent className="space-y-2 text-sm">
              <div className="flex flex-wrap gap-2">
                <Badge variant={doc.status === "reviewed" ? "green" : "amber"}>{PATIENT_STATUS[doc.status ?? ""] ?? doc.status}</Badge>
                {doc.important_finding && <Badge variant="red">Urgent review</Badge>}
                {doc.entered_by_hand && <Badge variant="blue">Typed in by hand</Badge>}
              </div>
              {doc.status_reason && <p>{doc.status_reason}</p>}
              <p>Arrived by: {doc.upload_channel?.replace(/_/g, " ")}</p>
              {doc.investigation_date && <p>Test date: {formatPatientDate(doc.investigation_date)}</p>}
              {doc.source_facility_name && <p>From: {doc.source_facility_name}</p>}
              {act && (
                <Link href={`/clinician/patients/${patientId}?tab=${act.tab}`} className="inline-block font-medium text-brand-green hover:underline">{act.label}</Link>
              )}
            </CardContent>
          </Card>
          <Card>
            <CardHeader><CardTitle>Earlier of the same kind</CardTitle></CardHeader>
            <CardContent>
              {earlier.length === 0 ? (
                <p className="text-sm text-charcoal-ink/60">None on the record.</p>
              ) : (
                <ul className="space-y-1 text-sm">
                  {earlier.map((e) => (
                    <li key={e.id}>
                      <Link href={`/clinician/patients/${patientId}/records/${e.id}`} className="underline">{e.kind_label ?? "Document"}</Link>{" "}
                      <span className="text-charcoal-ink/60">{formatPatientDate(e.investigation_date ?? e.uploaded_at ?? "")} · {PATIENT_STATUS[e.status ?? ""] ?? e.status}</span>
                    </li>
                  ))}
                </ul>
              )}
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
