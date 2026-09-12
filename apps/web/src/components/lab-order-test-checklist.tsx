"use client";

import { useState } from "react";
import { useLabOrderTestStatuses, useSetLabOrderTestStatus, type TestStatusValue } from "@/lib/queries/lab-orders";
import { testCodeLabel } from "@/lib/labs/test-code-labels";
import { PatientResultUpload } from "@/components/patient-result-upload";
import { EcgReportUpload } from "@/components/ecg-report-upload";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

const STATUS_OPTIONS: { value: TestStatusValue; label: string }[] = [
  { value: "not_yet_done", label: "Not yet done" },
  { value: "done", label: "Done" },
  { value: "will_not_do", label: "Will not be doing" },
];

/**
 * Per-test checklist for a multi-test lab order (e.g. Essential/Core
 * Screen): one highlighted card per test in the panel, each with its own
 * done / not yet done / will not be doing state and, once marked done, its
 * own upload slot — so a patient who got half the panel done at one lab can
 * say exactly which half, rather than one upload standing in for the whole
 * order. Backed by lab_order_test_status (2026-09-11); a test with no row
 * defaults to "not yet done" without needing one pre-seeded.
 *
 * ecg_resting routes to EcgReportUpload (its own dedicated table,
 * ecg_report_documents) instead of a test_code-scoped PatientResultUpload —
 * an ECG has no code-level ambiguity to resolve, there is only ever one per
 * order.
 */
export function LabOrderTestChecklist({
  labOrderId,
  testCodes,
}: {
  labOrderId: string;
  testCodes: readonly string[];
}) {
  const { data: statuses } = useLabOrderTestStatuses(labOrderId);
  const setStatus = useSetLabOrderTestStatus();
  const [openCode, setOpenCode] = useState<string | null>(null);

  const statusByCode = new Map((statuses ?? []).map((s) => [s.test_code, s.status as TestStatusValue]));

  return (
    <div className="space-y-2">
      {testCodes.map((code) => {
        const status = statusByCode.get(code) ?? "not_yet_done";
        const isEcg = code === "ecg_resting";
        const isOpen = openCode === code;
        return (
          <div
            key={code}
            className={cn(
              "space-y-2 rounded-md border p-3 transition-colors",
              status === "done"
                ? "border-brand-green/40 bg-brand-green/5"
                : status === "will_not_do"
                  ? "border-charcoal-ink/10 bg-charcoal-ink/[0.02] dark:border-night-ink/15 dark:bg-night-ink/[0.03] opacity-70"
                  : "border-amber-300/60 bg-amber-50/60 dark:border-amber-500/30 dark:bg-amber-500/10"
            )}
          >
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="text-sm font-medium text-charcoal-ink dark:text-night-ink">{testCodeLabel(code)}</p>
              <div className="flex flex-wrap gap-1">
                {STATUS_OPTIONS.map((opt) => (
                  <button
                    key={opt.value}
                    type="button"
                    disabled={setStatus.isPending}
                    aria-pressed={status === opt.value}
                    onClick={() => setStatus.mutate({ labOrderId, testCode: code, status: opt.value })}
                    className={cn(
                      "rounded-full border px-2.5 py-1 text-xs font-medium transition-colors",
                      status === opt.value
                        ? "border-brand-green bg-brand-green text-white"
                        : "border-charcoal-ink/15 text-charcoal-ink/70 hover:border-charcoal-ink/30 dark:border-night-ink/20 dark:text-night-ink/70"
                    )}
                  >
                    {opt.label}
                  </button>
                ))}
              </div>
            </div>

            {status !== "will_not_do" && (
              <>
                {!isOpen ? (
                  <Button type="button" size="sm" variant="outline" onClick={() => setOpenCode(code)}>
                    {isEcg ? "Upload this ECG" : "Upload this result"}
                  </Button>
                ) : isEcg ? (
                  <EcgReportUpload labOrderId={labOrderId} label="Upload your 12-lead ECG" />
                ) : (
                  <PatientResultUpload labOrderId={labOrderId} testCode={code} label={`Upload: ${testCodeLabel(code)}`} />
                )}
              </>
            )}
          </div>
        );
      })}
    </div>
  );
}
