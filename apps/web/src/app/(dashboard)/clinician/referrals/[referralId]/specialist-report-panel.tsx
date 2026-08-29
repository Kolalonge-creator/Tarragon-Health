"use client";

import { useRef, useState, useTransition } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  confirmSpecialistConsultationExtractionAction,
  discardSpecialistConsultationExtractionAction,
  extractSpecialistConsultationReportAction,
  uploadSpecialistConsultationReportForPatient,
} from "@/lib/specialist-reports/actions";
import { SPECIALIST_CONSULTATION_DOC_ACCEPT } from "@/lib/validation/specialist-consultation-documents";
import {
  useSpecialistConsultationDocuments,
  type SpecialistConsultationExtraction,
} from "@/lib/queries/specialist-consultation";
import { RECOMMENDATION_ACTION_TYPES, type RecommendationActionType } from "@/lib/specialist-reports/extract";

const ACTION_TYPE_LABEL: Record<RecommendationActionType, string> = {
  repeat_test: "Repeat test",
  investigation: "Investigation",
  follow_up_appointment: "Follow-up appointment",
  medication_review: "Medication review (doctor)",
  care_plan_review: "Care plan review (doctor)",
  other: "Other",
};

function formatDate(value: string): string {
  return new Date(value).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
}

function UploadForm({ referralId }: { referralId: string }) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const formRef = useRef<HTMLFormElement>(null);

  return (
    <form
      ref={formRef}
      className="flex flex-wrap items-end gap-2 rounded-lg border border-dashed border-charcoal-ink/20 p-3"
      action={(formData) => {
        setError(null);
        startTransition(async () => {
          const result = await uploadSpecialistConsultationReportForPatient(formData);
          if (result.error) setError(result.error);
          else formRef.current?.reset();
        });
      }}
    >
      <input type="hidden" name="referral_id" value={referralId} />
      <div className="space-y-1">
        <label className="text-xs font-medium text-charcoal-ink/70">Specialist&apos;s report</label>
        <input
          type="file"
          name="file"
          accept={SPECIALIST_CONSULTATION_DOC_ACCEPT}
          required
          className="block text-xs"
        />
      </div>
      <Input name="note" placeholder="Note (optional)" className="h-8 min-w-40 flex-1 text-xs" />
      <Button type="submit" size="sm" disabled={pending}>
        {pending ? "Uploading…" : "Upload report"}
      </Button>
      {error && <p className="w-full text-xs text-red-600">{error}</p>}
    </form>
  );
}

function ReviewCard({
  documentId,
  originalFilename,
  extraction,
}: {
  documentId: string;
  originalFilename: string | null;
  extraction: SpecialistConsultationExtraction | null;
}) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const recommendations = (extraction?.recommendations ?? []) as unknown as {
    description: string;
    action_type: RecommendationActionType;
    suggested_due_days: number | null;
    confidence: string;
  }[];

  const [diagnosis, setDiagnosis] = useState(extraction?.diagnosis ?? "");
  const [accepted, setAccepted] = useState<Record<number, boolean>>(
    Object.fromEntries(recommendations.map((_, i) => [i, true])),
  );
  const [actionTypes, setActionTypes] = useState<Record<number, RecommendationActionType>>(
    Object.fromEntries(recommendations.map((r, i) => [i, r.action_type])),
  );
  const [followUpDays, setFollowUpDays] = useState(
    extraction?.follow_up_interval_days ? String(extraction.follow_up_interval_days) : "",
  );

  function run(action: () => Promise<{ error?: string; message?: string }>) {
    setError(null);
    setMessage(null);
    startTransition(async () => {
      const result = await action();
      if (result.error) setError(result.error);
      if (result.message) setMessage(result.message);
    });
  }

  if (!extraction) {
    return (
      <div className="rounded-lg border border-charcoal-ink/10 bg-charcoal-ink/[0.02] p-3">
        <p className="text-xs text-charcoal-ink/70">{originalFilename ?? "Report"} — not yet read.</p>
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="mt-2"
          disabled={pending}
          onClick={() => run(() => extractSpecialistConsultationReportAction(documentId))}
        >
          {pending ? "Reading the report…" : "Read this report"}
        </Button>
        {error && <p className="mt-2 text-xs text-red-600">{error}</p>}
      </div>
    );
  }

  if (extraction.status === "confirmed") {
    return (
      <p className="text-xs text-charcoal-ink/70">
        {originalFilename ?? "Report"} — filed{extraction.report_date ? ` (${formatDate(extraction.report_date)})` : ""}.
        {extraction.diagnosis ? ` Diagnosis: ${extraction.diagnosis}.` : ""}
      </p>
    );
  }

  if (extraction.status === "discarded") {
    return <p className="text-xs text-charcoal-ink/50">{originalFilename ?? "Report"} — draft discarded.</p>;
  }

  if (extraction.status === "failed") {
    return (
      <div className="rounded-lg border border-amber-300 bg-amber-50 p-3">
        <p className="text-xs text-amber-900">
          {extraction.error_message ?? "This report could not be read automatically."}
        </p>
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="mt-2"
          disabled={pending}
          onClick={() => run(() => extractSpecialistConsultationReportAction(documentId))}
        >
          Try again
        </Button>
      </div>
    );
  }

  // status === 'extracted' — review + confirm
  const acceptedCount = Object.values(accepted).filter(Boolean).length;

  function submit() {
    if (!diagnosis.trim()) {
      setError("A diagnosis/impression is required to file this report.");
      return;
    }
    const acceptedRecommendations = recommendations
      .map((r, i) => ({ r, i }))
      .filter(({ i }) => accepted[i])
      .map(({ r, i }) => ({
        description: r.description,
        action_type: actionTypes[i] ?? r.action_type,
      }));

    // extraction is guaranteed non-null here (the null/confirmed/discarded/
    // failed cases all return earlier) — TS doesn't narrow a closured prop
    // across this nested function, hence the assertion.
    run(() =>
      confirmSpecialistConsultationExtractionAction({
        extraction_id: extraction!.id,
        diagnosis: diagnosis.trim(),
        accepted_recommendations: acceptedRecommendations,
        follow_up_interval_days: followUpDays ? Number(followUpDays) : undefined,
        report_date: extraction!.report_date ?? undefined,
      }),
    );
  }

  return (
    <div className="space-y-3 rounded-lg border border-charcoal-ink/15 bg-white p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm font-medium text-charcoal-ink">{originalFilename ?? "Report"} — check before filing</p>
        <Badge variant="amber">AI-drafted, not yet filed</Badge>
      </div>

      {extraction.unreadable_reason && (
        <p className="rounded border border-amber-300 bg-amber-50 p-2 text-xs text-amber-900">
          {extraction.unreadable_reason}
        </p>
      )}

      <div className="space-y-1">
        <label className="text-xs font-medium text-charcoal-ink/70">Diagnosis / impression</label>
        <Textarea value={diagnosis} onChange={(e) => setDiagnosis(e.target.value)} rows={2} className="text-xs" />
      </div>

      {recommendations.length === 0 ? (
        <p className="text-xs text-charcoal-ink/60">No distinct recommendations were read from this report.</p>
      ) : (
        <ul className="space-y-2">
          {recommendations.map((rec, i) => (
            <li key={i} className="rounded border border-charcoal-ink/10 p-2">
              <div className="flex flex-wrap items-start gap-2">
                <input
                  type="checkbox"
                  checked={Boolean(accepted[i])}
                  onChange={(e) => setAccepted((s) => ({ ...s, [i]: e.target.checked }))}
                  className="mt-1"
                  aria-label={`Accept recommendation: ${rec.description}`}
                />
                <div className="min-w-0 flex-1 space-y-1">
                  <p className="text-xs text-charcoal-ink">{rec.description}</p>
                  <div className="flex items-center gap-2">
                    <select
                      value={actionTypes[i] ?? rec.action_type}
                      onChange={(e) =>
                        setActionTypes((s) => ({ ...s, [i]: e.target.value as RecommendationActionType }))
                      }
                      className="rounded border border-charcoal-ink/20 px-1 py-0.5 text-xs"
                      disabled={!accepted[i]}
                    >
                      {RECOMMENDATION_ACTION_TYPES.map((t) => (
                        <option key={t} value={t}>
                          {ACTION_TYPE_LABEL[t]}
                        </option>
                      ))}
                    </select>
                    {rec.suggested_due_days != null && (
                      <span className="text-[0.65rem] text-charcoal-ink/50">
                        suggested in ~{rec.suggested_due_days}d
                      </span>
                    )}
                    {rec.confidence === "low" && (
                      <span className="text-[0.65rem] text-amber-700">low confidence — check wording</span>
                    )}
                  </div>
                </div>
              </div>
            </li>
          ))}
        </ul>
      )}

      <div className="space-y-1">
        <label className="text-xs font-medium text-charcoal-ink/70">Overall follow-up (days)</label>
        <Input
          type="number"
          min={1}
          value={followUpDays}
          onChange={(e) => setFollowUpDays(e.target.value)}
          className="h-8 w-24 text-xs"
        />
      </div>

      {error && <p className="text-xs text-red-600">{error}</p>}
      {message && <p className="text-xs text-brand-green">{message}</p>}

      <div className="flex flex-wrap gap-2">
        <Button type="button" size="sm" disabled={pending} onClick={submit}>
          {pending ? "Filing…" : `File plan (${acceptedCount} action item${acceptedCount === 1 ? "" : "s"})`}
        </Button>
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={pending}
          onClick={() => run(() => discardSpecialistConsultationExtractionAction(extraction.id))}
        >
          Discard draft
        </Button>
      </div>
      <p className="text-[0.65rem] text-charcoal-ink/50">
        Medications mentioned on the report are informational only — start or adjust a prescription
        through the usual flow, never from this screen. A medication_review/care_plan_review item goes
        to the doctor worklist instead of being auto-prescribed.
      </p>
    </div>
  );
}

/**
 * Spec §70.3 — specialist report ingestion. Upload the report, read it into
 * a structured draft, review side by side, file it. Filing (confirm RPC)
 * stamps treatment_plan_received_at/plan_acknowledged_at on the referral and
 * creates one tracked action item per accepted recommendation — see the
 * confirm_specialist_consultation_extraction migration.
 */
export function SpecialistReportSection({ referralId }: { referralId: string }) {
  const { data: documents, isLoading, isError } = useSpecialistConsultationDocuments(referralId);

  return (
    <div className="space-y-3">
      <UploadForm referralId={referralId} />
      {isLoading && <p className="text-xs text-charcoal-ink/60">Loading…</p>}
      {isError && <p className="text-xs text-red-600">Could not load uploaded reports.</p>}
      {documents && documents.length === 0 && (
        <p className="text-xs text-charcoal-ink/60">
          No report uploaded yet. If one arrives outside the app (phone call, paper letter), record it
          via &ldquo;Record treatment plan&rdquo; below instead.
        </p>
      )}
      {documents?.map((doc) => (
        <ReviewCard
          key={doc.id}
          documentId={doc.id}
          originalFilename={doc.original_filename}
          extraction={doc.extraction}
        />
      ))}
    </div>
  );
}
