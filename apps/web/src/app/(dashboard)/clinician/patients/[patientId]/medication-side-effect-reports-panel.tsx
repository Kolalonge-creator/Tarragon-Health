"use client";

import { useState } from "react";
import {
  useMedicationSideEffectReports,
  useReviewSideEffectReport,
  type MedicationSideEffectReportWithContext,
} from "@/lib/queries/medication-side-effects";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";

const SEVERITY_VARIANT: Record<string, "red" | "amber" | "grey"> = {
  severe: "red",
  moderate: "amber",
  mild: "grey",
};

function ReportRow({ report }: { report: MedicationSideEffectReportWithContext }) {
  const review = useReviewSideEffectReport();
  const [notes, setNotes] = useState("");

  return (
    <li className="space-y-2 py-3">
      <div className="flex flex-wrap items-center gap-2">
        <Badge variant={SEVERITY_VARIANT[report.severity] ?? "grey"}>{report.severity}</Badge>
        <p className="text-sm font-medium text-charcoal-ink">
          {report.medication?.drug_name ?? "A medication"} — {report.symptom}
        </p>
        <span className="text-xs text-charcoal-ink/50">
          {new Date(report.reported_at).toLocaleDateString()}
        </span>
      </div>
      {(report.duration_text || report.description) && (
        <p className="text-sm text-charcoal-ink/70">
          {[report.duration_text, report.description].filter(Boolean).join(" — ")}
        </p>
      )}
      {report.status === "new" ? (
        <div className="space-y-1.5">
          <Textarea
            placeholder="Review notes (optional)"
            value={notes}
            onChange={(event) => setNotes(event.target.value)}
            rows={1}
            className="text-sm"
          />
          <div className="flex gap-2">
            <Button
              size="sm"
              variant="outline"
              disabled={review.isPending}
              onClick={() =>
                review.mutate({
                  reportId: report.id,
                  status: "reviewed",
                  reviewNotes: notes.trim() || null,
                })
              }
            >
              Mark reviewed
            </Button>
            <Button
              size="sm"
              variant="ghost"
              disabled={review.isPending}
              onClick={() =>
                review.mutate({
                  reportId: report.id,
                  status: "dismissed",
                  reviewNotes: notes.trim() || null,
                })
              }
            >
              Dismiss
            </Button>
          </div>
          {review.isError && (
            <p className="text-xs text-red-600">
              {(review.error as Error).message || "Could not update this report."}
            </p>
          )}
        </div>
      ) : (
        <Badge variant="grey">{report.status === "reviewed" ? "Reviewed" : "Dismissed"}</Badge>
      )}
    </li>
  );
}

/** 13.8's clinician-facing half — the same structured reports a patient
 * submits via SideEffectReportForm, with a review action. Moderate/severe
 * reports also already reached the unified clinician_alerts inbox
 * automatically; this panel is the fuller record, scoped to this patient. */
export function MedicationSideEffectReportsPanel({ patientId }: { patientId: string }) {
  const { data, isLoading, isError } = useMedicationSideEffectReports(patientId);

  if (isLoading || isError || !data || data.length === 0) return null;

  return (
    <Card>
      <CardHeader>
        <CardTitle>Reported side effects</CardTitle>
      </CardHeader>
      <CardContent>
        <ul className="divide-y divide-charcoal-ink/10">
          {data.map((report) => (
            <ReportRow key={report.id} report={report} />
          ))}
        </ul>
      </CardContent>
    </Card>
  );
}
