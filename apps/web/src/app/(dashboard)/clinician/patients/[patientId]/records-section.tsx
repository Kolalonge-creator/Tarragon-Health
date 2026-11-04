import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { formatPatientDate } from "@/lib/format-date";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { groupByPipeline, loadRecordItems, PATIENT_STATUS, previousOfSameKind } from "@/lib/clinical-documents/record-items";

/**
 * Clinical Records and Investigations (clinical document engine step 6): every uploaded document of every kind, grouped, with its
 * status, an urgent marker when its review alert is urgent, and how many earlier documents of the same kind exist. Each opens in
 * the side-by-side viewer. The list is clinical_record_items through the clinician's own session (the care tie applies).
 */
export async function RecordsSection({ patientId }: { patientId: string }) {
  const supabase = await createClient();
  // The list links onward to the viewer, so no file links are made here.
  const items = await loadRecordItems(supabase, patientId, { sign: "none" });
  if (items.length === 0) {
    return (
      <Card>
        <CardHeader><CardTitle>Records and investigations</CardTitle></CardHeader>
        <CardContent><p className="text-sm text-charcoal-ink/60">No documents on this record yet.</p></CardContent>
      </Card>
    );
  }
  return (
    <Card>
      <CardHeader>
        <CardTitle>Records and investigations</CardTitle>
        <CardDescription>Every uploaded document, whichever way it arrived. Open one to see the original beside what was read or filed from it, and the earlier ones of the same kind.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-5">
        {groupByPipeline(items).map((g) => (
          <section key={g.pipeline}>
            <h3 className="mb-1 text-sm font-semibold">{g.label} ({g.items.length})</h3>
            <ul className="divide-y divide-charcoal-ink/10 dark:divide-night-ink/15">
              {g.items.map((i) => {
                const earlier = previousOfSameKind(items, i).length;
                return (
                  <li key={i.id} className="flex flex-wrap items-center justify-between gap-2 py-2 text-sm">
                    <div className="flex flex-wrap items-center gap-2">
                      <Link href={`/clinician/patients/${patientId}/records/${i.id}`} className="font-medium underline">{i.kind_label ?? "Not yet sorted"}</Link>
                      {i.important_finding && <Badge variant="red">Urgent</Badge>}
                      {i.entered_by_hand && <Badge variant="blue">Typed in by hand</Badge>}
                      <span className="text-charcoal-ink/60 dark:text-night-ink/60">
                        {i.investigation_date ? `${formatPatientDate(i.investigation_date)} · ` : ""}added {formatPatientDate(i.uploaded_at ?? "")}
                        {earlier > 0 ? ` · ${earlier} earlier` : ""}
                      </span>
                    </div>
                    <Badge variant={i.status === "reviewed" ? "green" : i.status === "processing_failed" ? "red" : "amber"}>{PATIENT_STATUS[i.status ?? ""] ?? i.status}</Badge>
                  </li>
                );
              })}
            </ul>
          </section>
        ))}
      </CardContent>
    </Card>
  );
}
