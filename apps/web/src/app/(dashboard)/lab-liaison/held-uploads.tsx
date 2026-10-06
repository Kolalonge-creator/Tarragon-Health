import type { LiaisonUploadRow } from "@/lib/lab-results/structured";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";

/** What the liaison can see about a file they recorded: when, for which patient and order, and one of two neutral words. */
export function HeldUploads({ rows }: { rows: LiaisonUploadRow[] }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Files you recorded (last 30 days)</CardTitle>
      </CardHeader>
      <CardContent>
        {rows.length === 0 ? (
          <p className="text-sm text-charcoal-ink/60">Nothing recorded yet. After you upload a result it appears here, and the patient sees it only once a clinician has reviewed it.</p>
        ) : (
          <ul className="space-y-2">
            {rows.map((r) => (
              <li key={r.lab_result_id} className="flex flex-wrap items-center justify-between gap-2 rounded-md border p-3 text-sm">
                <span>
                  {r.patient_number ?? "Patient"}
                  {r.order_number ? ` · order ${r.order_number}` : ""}
                  {r.file_name ? ` · ${r.file_name}` : ""}
                  <span className="text-charcoal-ink/60"> · {new Date(r.received_at).toLocaleString("en-NG", { timeZone: "Africa/Lagos" })}</span>
                </span>
                <Badge variant={r.status === "reviewed" ? "green" : "amber"}>{r.status === "reviewed" ? "Reviewed" : "Waiting for review"}</Badge>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
