"use client";

import { useState } from "react";
import { z } from "zod";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import type { Tables } from "@tarragon/shared";
import { CARE_PLAN_CATEGORY_LABEL } from "@/lib/care-plan/patient-copy";
import { formatPlanDate } from "@/lib/care-plan/plan-view";
import {
  useCarePlanRevisionsForPlan,
  usePublishCarePlanRevision,
  useUpdateCarePlanReviewDates,
} from "@/lib/queries/care-plan-revisions";

type Plan = Tables<"care_plans">;
type Intervention = Tables<"care_plan_interventions">;

/** "Daily habits · Why: … · When: … · How: …" for the clinician's action list; null when none of it is set. */
export function actionDetailLine(i: Pick<Intervention, "category" | "why_text" | "when_text" | "how_text">): string | null {
  const parts = [
    i.category ? CARE_PLAN_CATEGORY_LABEL[i.category] : null,
    i.why_text ? `Why: ${i.why_text}` : null,
    i.when_text ? `When: ${i.when_text}` : null,
    i.how_text ? `How: ${i.how_text}` : null,
  ].filter((p): p is string => p !== null);
  return parts.length > 0 ? parts.join(" · ") : null;
}

const DateField = z.union([z.literal(""), z.string().regex(/^\d{4}-\d{2}-\d{2}$/)]);

/** Validates the review-dates form. A reviewed date is stored as noon Lagos time that day; next review must not be earlier. */
export function parseReviewDates(input: { lastReviewed: string; nextReview: string }):
  | { ok: true; lastReviewedAt: string | null; nextReviewAt: string | null }
  | { ok: false; error: string } {
  const parsed = z.object({ lastReviewed: DateField, nextReview: DateField }).safeParse(input);
  if (!parsed.success) return { ok: false, error: "Enter dates as day, month and year." };
  const { lastReviewed, nextReview } = parsed.data;
  if (lastReviewed && nextReview && nextReview < lastReviewed) {
    return { ok: false, error: "The next review cannot be before the last review." };
  }
  return {
    ok: true,
    lastReviewedAt: lastReviewed ? `${lastReviewed}T12:00:00+01:00` : null,
    nextReviewAt: nextReview || null,
  };
}

/** Validates the "what changed" note (5 to 600 characters, matching the database check). */
export function parseChangeNote(note: string): { ok: true; summary: string } | { ok: false; error: string } {
  const parsed = z.string().trim().min(5).max(600).safeParse(note);
  return parsed.success
    ? { ok: true, summary: parsed.data }
    : { ok: false, error: "Write what changed in 5 to 600 characters." };
}

/** The Lagos calendar date (YYYY-MM-DD) of a stored timestamp, for a date input; empty when unset. */
export function toDateInput(value: string | null): string {
  if (!value) return "";
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) return value;
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleDateString("en-CA", { timeZone: "Africa/Lagos" });
}

/**
 * PD-06: on each care plan, the doctor sets the review dates and, when saving a plan change, writes a short plain-words
 * "what changed" note and ticks whether the patient must acknowledge it. The patient sees the note on their Care Plan page.
 * The database refuses a care coordinator or a doctor not caring for this patient; a refusal is shown, never treated as saved.
 */
export function CarePlanReviewPanel({ plan }: { plan: Plan }) {
  const updateDates = useUpdateCarePlanReviewDates(plan.patient_id);
  const publish = usePublishCarePlanRevision();
  const { data: revisions, isError: revisionsFailed } = useCarePlanRevisionsForPlan(plan.id);

  const [lastReviewed, setLastReviewed] = useState(toDateInput(plan.last_reviewed_at));
  const [nextReview, setNextReview] = useState(toDateInput(plan.next_review_at));
  const [datesError, setDatesError] = useState<string | null>(null);
  const [datesSaved, setDatesSaved] = useState(false);

  const [note, setNote] = useState("");
  const [needsAck, setNeedsAck] = useState(false);
  const [noteError, setNoteError] = useState<string | null>(null);
  const [noteSaved, setNoteSaved] = useState(false);

  function saveDates() {
    setDatesSaved(false);
    const parsed = parseReviewDates({ lastReviewed, nextReview });
    if (!parsed.ok) {
      setDatesError(parsed.error);
      return;
    }
    setDatesError(null);
    updateDates.mutate(
      { carePlanId: plan.id, lastReviewedAt: parsed.lastReviewedAt, nextReviewAt: parsed.nextReviewAt },
      {
        onSuccess: () => setDatesSaved(true),
        onError: (e) => setDatesError(e instanceof Error ? e.message : "The dates were not saved."),
      },
    );
  }

  function saveChange() {
    setNoteSaved(false);
    const parsed = parseChangeNote(note);
    if (!parsed.ok) {
      setNoteError(parsed.error);
      return;
    }
    setNoteError(null);
    publish.mutate(
      { carePlanId: plan.id, changeSummary: parsed.summary, needsAcknowledgement: needsAck },
      {
        onSuccess: () => {
          setNote("");
          setNeedsAck(false);
          setNoteSaved(true);
        },
        onError: () => setNoteError("The change was not saved. Only a doctor caring for this patient can save a plan change."),
      },
    );
  }

  return (
    <div className="space-y-3 border-t border-charcoal-ink/10 pt-3">
      <p className="text-xs font-medium uppercase tracking-wide text-charcoal-ink/50">Review dates</p>
      <div className="flex flex-wrap items-end gap-2">
        <label className="text-xs text-charcoal-ink/70">
          Last reviewed
          <Input type="date" value={lastReviewed} onChange={(e) => setLastReviewed(e.target.value)} className="h-8 w-40 text-xs" />
        </label>
        <label className="text-xs text-charcoal-ink/70">
          Next review
          <Input type="date" value={nextReview} onChange={(e) => setNextReview(e.target.value)} className="h-8 w-40 text-xs" />
        </label>
        <Button type="button" size="sm" className="h-8 px-3 text-xs" disabled={updateDates.isPending} onClick={saveDates}>
          {updateDates.isPending ? "Saving…" : "Save dates"}
        </Button>
      </div>
      {datesError && <p className="text-xs text-red-600">{datesError}</p>}
      {datesSaved && <p className="text-xs text-brand-green">Review dates saved.</p>}

      <p className="pt-1 text-xs font-medium uppercase tracking-wide text-charcoal-ink/50">Save a plan change</p>
      <Textarea
        value={note}
        onChange={(e) => setNote(e.target.value)}
        maxLength={600}
        rows={2}
        placeholder="What changed, in plain words the patient will read, e.g. We added a morning blood pressure check."
        className="text-xs"
      />
      <label className="flex items-center gap-2 text-xs text-charcoal-ink/70">
        <input type="checkbox" checked={needsAck} onChange={(e) => setNeedsAck(e.target.checked)} />
        Patient must acknowledge this change
      </label>
      <Button type="button" size="sm" className="h-8 px-3 text-xs" disabled={publish.isPending || !note.trim()} onClick={saveChange}>
        {publish.isPending ? "Saving…" : "Save plan change"}
      </Button>
      {noteError && <p className="text-xs text-red-600">{noteError}</p>}
      {noteSaved && <p className="text-xs text-brand-green">Plan change saved. The patient will see it on their care plan.</p>}

      {revisionsFailed ? (
        <p className="text-xs text-red-600">Could not load the saved plan changes.</p>
      ) : (
        (revisions ?? []).length > 0 && (
          <ul className="space-y-1 rounded-md bg-charcoal-ink/5 p-2 text-xs">
            {(revisions ?? []).map((r) => (
              <li key={r.id} className="text-charcoal-ink/70">
                v{r.version_number} · {formatPlanDate(r.published_at)} · {r.change_summary}{" "}
                {r.needs_acknowledgement &&
                  (r.acknowledged_at ? (
                    <Badge variant="green">Acknowledged {formatPlanDate(r.acknowledged_at)}</Badge>
                  ) : (
                    <Badge variant="amber">Waiting for the patient</Badge>
                  ))}
              </li>
            ))}
          </ul>
        )
      )}
    </div>
  );
}
