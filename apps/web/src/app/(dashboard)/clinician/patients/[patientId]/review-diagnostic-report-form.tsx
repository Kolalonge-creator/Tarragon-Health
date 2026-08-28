"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useMutation } from "@tanstack/react-query";
import { reviewDiagnosticReport, markDiagnosticReportActionCompleted } from "@/lib/diagnostic-services/actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";

/**
 * Clinician structured review of an uploaded diagnostic report (15.6) —
 * findings, impression, reporting clinician, date, facility — and the
 * abnormal flag (15.9). Flagging abnormal raises an urgent clinician_alerts
 * row through the SAME Abnormal Result Engine every other abnormal-result
 * pathway uses (private.handle_diagnostic_report_review), not a separate
 * mechanism.
 */
export function ReviewDiagnosticReportForm({ reportId }: { reportId: string }) {
  const router = useRouter();
  const [findings, setFindings] = useState("");
  const [impression, setImpression] = useState("");
  const [reportingClinicianName, setReportingClinicianName] = useState("");
  const [reportDate, setReportDate] = useState("");
  const [facilityName, setFacilityName] = useState("");
  const [isAbnormal, setIsAbnormal] = useState(false);
  const [abnormalSeverity, setAbnormalSeverity] = useState<"abnormal" | "critical">("abnormal");

  const review = useMutation({
    mutationFn: async () => {
      const result = await reviewDiagnosticReport({
        report_id: reportId,
        findings: findings.trim() || undefined,
        impression: impression.trim() || undefined,
        reporting_clinician_name: reportingClinicianName.trim() || undefined,
        report_date: reportDate || undefined,
        facility_name: facilityName.trim() || undefined,
        is_abnormal: isAbnormal,
        abnormal_severity: isAbnormal ? abnormalSeverity : undefined,
      });
      if (result.error) throw new Error(result.error);
    },
    onSuccess: () => router.refresh(),
  });

  return (
    <div className="space-y-3 rounded-lg border border-charcoal-ink/10 bg-warm-ivory/50 p-3">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <div className="space-y-1.5">
          <Label htmlFor={`reporting-clinician-${reportId}`}>Reporting clinician</Label>
          <Input
            id={`reporting-clinician-${reportId}`}
            value={reportingClinicianName}
            onChange={(e) => setReportingClinicianName(e.target.value)}
            placeholder="e.g. Dr A. Okafor"
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor={`report-date-${reportId}`}>Report date</Label>
          <input
            id={`report-date-${reportId}`}
            type="date"
            value={reportDate}
            onChange={(e) => setReportDate(e.target.value)}
            className="flex h-10 w-full rounded-md border border-charcoal-ink/20 bg-white px-3 py-2 text-sm text-charcoal-ink"
          />
        </div>
      </div>
      <div className="space-y-1.5">
        <Label htmlFor={`facility-name-${reportId}`}>Facility</Label>
        <Input
          id={`facility-name-${reportId}`}
          value={facilityName}
          onChange={(e) => setFacilityName(e.target.value)}
          placeholder="Where the scan was performed"
        />
      </div>
      <div className="space-y-1.5">
        <Label htmlFor={`findings-${reportId}`}>Findings</Label>
        <Textarea
          id={`findings-${reportId}`}
          value={findings}
          onChange={(e) => setFindings(e.target.value)}
          maxLength={4000}
        />
      </div>
      <div className="space-y-1.5">
        <Label htmlFor={`impression-${reportId}`}>Impression</Label>
        <Textarea
          id={`impression-${reportId}`}
          value={impression}
          onChange={(e) => setImpression(e.target.value)}
          maxLength={2000}
        />
      </div>
      <label className="flex items-center gap-2 text-sm text-charcoal-ink">
        <input
          type="checkbox"
          checked={isAbnormal}
          onChange={(e) => setIsAbnormal(e.target.checked)}
        />
        Flag as abnormal — a machine-generated interpretation, if present on the report, is never
        the final read; only this checkbox does.
      </label>
      {isAbnormal && (
        <div className="space-y-1.5">
          <Label htmlFor={`severity-${reportId}`}>Severity</Label>
          <select
            id={`severity-${reportId}`}
            value={abnormalSeverity}
            onChange={(e) => setAbnormalSeverity(e.target.value as "abnormal" | "critical")}
            className="flex h-10 w-full rounded-md border border-charcoal-ink/20 bg-white px-3 py-2 text-sm text-charcoal-ink"
          >
            <option value="abnormal">Abnormal</option>
            <option value="critical">Critical</option>
          </select>
          <p className="text-xs text-charcoal-ink/60">
            This raises an urgent clinician alert with a contact SLA, same as any other abnormal
            result on the platform.
          </p>
        </div>
      )}
      {review.isError && <p className="text-xs text-red-600">{(review.error as Error).message}</p>}
      <Button size="sm" disabled={review.isPending} onClick={() => review.mutate()}>
        {review.isPending ? "Saving…" : "File review"}
      </Button>
    </div>
  );
}

/** Confirms an abnormal-finding follow-up (referral, care plan update, etc.)
 * actually happened — distinct from the review itself. Only shown once a
 * report is in action_required. */
export function MarkDiagnosticReportActionCompleted({ reportId }: { reportId: string }) {
  const router = useRouter();
  const complete = useMutation({
    mutationFn: async () => {
      const result = await markDiagnosticReportActionCompleted({ report_id: reportId });
      if (result.error) throw new Error(result.error);
    },
    onSuccess: () => router.refresh(),
  });

  return (
    <div className="space-y-1">
      <Button size="sm" variant="outline" disabled={complete.isPending} onClick={() => complete.mutate()}>
        {complete.isPending ? "Saving…" : "Mark follow-up completed"}
      </Button>
      {complete.isError && <p className="text-xs text-red-600">{(complete.error as Error).message}</p>}
    </div>
  );
}
