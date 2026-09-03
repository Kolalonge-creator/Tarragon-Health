"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useMutation } from "@tanstack/react-query";
import { markResultDocumentReviewed } from "@/lib/lab-results/actions";
import { draftInterpretationFromRows } from "@/lib/lab-results/draft-interpretation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import type { ExtractionView } from "./lab-report-extraction-panel";

interface Props {
  documentId: string;
  /** Confirmed/filed values for this document, if any were extracted and filed. */
  extraction: ExtractionView | null;
  patientSex: string | null;
  patientAgeYears: number | null;
}

/**
 * Clinician control to mark an uploaded result document reviewed and send the
 * patient a plain-language interpretation of it — the "upload any lab result
 * and a doctor's plain-language interpretation is sent to you in the app"
 * promise (apps/web/src/app/(marketing)/_content/pricing.ts). Interpretation
 * is required; next steps are optional and should only be filled in when the
 * result needs the patient to do something.
 *
 * When the report's values have already been filed (LabReportExtractionPanel,
 * above this component on the page), "Draft from filed results" composes a
 * starting-point interpretation from them — same "AI reads it, doctor
 * cross-checks, edits, approves" shape as filing the numbers themselves. It
 * never auto-fills next steps: that stays a judgement only the doctor makes.
 */
export function MarkResultReviewed({ documentId, extraction, patientSex, patientAgeYears }: Props) {
  const router = useRouter();
  const [interpretation, setInterpretation] = useState("");
  const [nextSteps, setNextSteps] = useState("");
  const [note, setNote] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [drafted, setDrafted] = useState(false);

  const canDraft =
    extraction?.status === "confirmed" && (extraction.confirmedCodes?.length ?? 0) > 0;

  function draftFromFiledResults() {
    if (!extraction) return;
    const draft = draftInterpretationFromRows(extraction.rows, extraction.confirmedCodes, {
      sex: patientSex === "male" || patientSex === "female" ? patientSex : null,
      ageYears: patientAgeYears,
    });
    if (draft) {
      setInterpretation(draft);
      setDrafted(true);
    }
  }

  const review = useMutation({
    mutationFn: async () => {
      const result = await markResultDocumentReviewed({
        documentId,
        interpretation: interpretation.trim(),
        nextSteps: nextSteps.trim() || undefined,
        note: note.trim() || undefined,
      });
      if (result.error) throw new Error(result.error);
    },
    onSuccess: () => {
      setError(null);
      router.refresh();
    },
    onError: (e: Error) => setError(e.message),
  });

  return (
    <div className="space-y-2 rounded-lg border border-charcoal-ink/10 bg-charcoal-ink/[0.02] p-3">
      <div>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <label className="text-xs font-medium text-charcoal-ink/70">
            What this result means: the patient will read this exactly
          </label>
          {canDraft && (
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="h-6 px-2 text-xs"
              onClick={draftFromFiledResults}
            >
              Draft from filed results
            </Button>
          )}
        </div>
        {drafted && (
          <p className="mt-1 text-[0.65rem] text-amber-700">
            Drafted from the filed results. Check it reads right for this patient before sending.
          </p>
        )}
        <Textarea
          placeholder="In plain language, explain what the result shows…"
          value={interpretation}
          onChange={(event) => {
            setInterpretation(event.target.value);
            setDrafted(false);
          }}
          rows={3}
          className="mt-1 max-w-lg text-sm"
        />
      </div>
      <div>
        <label className="text-xs font-medium text-charcoal-ink/70">
          Next steps (optional, only if something needs attention)
        </label>
        <Textarea
          placeholder="e.g. Book a follow-up blood test in 3 months…"
          value={nextSteps}
          onChange={(event) => setNextSteps(event.target.value)}
          rows={2}
          className="mt-1 max-w-lg text-sm"
        />
      </div>
      <div>
        <label className="text-xs font-medium text-charcoal-ink/70">
          Internal note (not shown to the patient)
        </label>
        <Input
          placeholder="Optional"
          value={note}
          onChange={(event) => setNote(event.target.value)}
          className="mt-1 max-w-md text-sm"
        />
      </div>
      <Button
        size="sm"
        disabled={review.isPending || interpretation.trim().length < 10}
        onClick={() => review.mutate()}
      >
        {review.isPending ? "Sending…" : "Send to patient & mark reviewed"}
      </Button>
      {error && <p className="text-xs text-red-600">{error}</p>}
    </div>
  );
}
