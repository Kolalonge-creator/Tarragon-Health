"use client";

import { useState } from "react";
import Link from "next/link";
import { useQueryClient } from "@tanstack/react-query";
import {
  useOrgAnnualReviews,
  useAdvanceAnnualReviewStage,
  useCompleteAnnualReview,
  useUpdateWorkupItem,
  useWorkupCatalogue,
  type AnnualReviewWithContext,
  type AnnualReviewWorkupItem,
} from "@/lib/queries/annual-reviews";
import { proposeAnnualReviewConsult, addWorkupItem } from "./actions";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select } from "@/components/ui/select";
import { Input } from "@/components/ui/input";

// The ordered pathway, mapped to the completion column each stage owns. The
// medication_review stage completion also triggers the DB-side reconciliation
// that adopts + rolls the patient's condition medication reviews.
const STAGES = [
  { key: "questionnaire", label: "Questionnaires", column: "questionnaire_completed_at" },
  { key: "labs", label: "Laboratory tests", column: "labs_completed_at" },
  { key: "medication_review", label: "Medication review", column: "medication_review_completed_at" },
  { key: "risk_score", label: "Risk score", column: "risk_score_computed_at" },
  { key: "care_plan", label: "Updated care plan", column: "care_plan_updated_at" },
  { key: "video_consult", label: "Video consult", column: "video_completed_at" },
] as const;

const WORKUP_STATUSES: AnnualReviewWorkupItem["status"][] = [
  "pending",
  "ordered",
  "completed",
  "not_applicable",
];

function WorkupRow({ item }: { item: AnnualReviewWorkupItem }) {
  const update = useUpdateWorkupItem();
  const [status, setStatus] = useState<AnnualReviewWorkupItem["status"]>(item.status);
  const [result, setResult] = useState(item.result_summary ?? "");

  return (
    <li className="flex flex-wrap items-center gap-2 py-1.5 text-sm">
      <span className="min-w-[10rem] font-medium text-charcoal-ink">{item.label}</span>
      <Select
        value={status}
        onChange={(e) => setStatus(e.target.value as AnnualReviewWorkupItem["status"])}
        className="h-8 text-xs"
      >
        {WORKUP_STATUSES.map((s) => (
          <option key={s} value={s}>
            {s.replace(/_/g, " ")}
          </option>
        ))}
      </Select>
      <input
        value={result}
        onChange={(e) => setResult(e.target.value)}
        placeholder="Result / note"
        className="h-8 flex-1 rounded-md border border-charcoal-ink/15 px-2 text-xs"
      />
      <Button
        size="sm"
        variant="outline"
        disabled={update.isPending}
        onClick={() =>
          update.mutate({ itemId: item.id, status, resultSummary: result.trim() || null })
        }
      >
        Save
      </Button>
    </li>
  );
}

function toIso(localValue: string): string | null {
  if (!localValue) return null;
  const d = new Date(localValue);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

/** Propose 1–3 candidate slots for the patient to confirm. */
function ConsultProposer({ review }: { review: AnnualReviewWithContext }) {
  const queryClient = useQueryClient();
  const [slots, setSlots] = useState<string[]>(["", "", ""]);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const consult = review.video_consult;
  if (consult?.scheduled_at) {
    return (
      <p className="text-sm text-charcoal-ink/70">
        Video consult confirmed for{" "}
        {new Date(consult.scheduled_at).toLocaleString("en-GB", {
          weekday: "short",
          day: "numeric",
          month: "short",
          hour: "2-digit",
          minute: "2-digit",
        })}
        .
      </p>
    );
  }
  if (consult && (consult.proposed_slots?.length ?? 0) > 0) {
    return (
      <p className="text-sm text-charcoal-ink/70">
        {consult.proposed_slots?.length} time(s) offered — awaiting the patient&apos;s pick.
      </p>
    );
  }

  const submit = async () => {
    const iso = slots.map(toIso).filter((s): s is string => Boolean(s));
    if (iso.length === 0) {
      setError("Enter at least one time.");
      return;
    }
    setPending(true);
    setError(null);
    const result = await proposeAnnualReviewConsult(review.id, iso);
    setPending(false);
    if (result && "error" in result) {
      setError(result.error);
      return;
    }
    queryClient.invalidateQueries({ queryKey: ["annual-reviews"] });
  };

  return (
    <div className="space-y-1.5">
      <p className="text-xs font-medium uppercase tracking-wide text-charcoal-ink/50">
        Offer video consult times
      </p>
      <div className="flex flex-wrap gap-2">
        {slots.map((value, i) => (
          <Input
            key={i}
            type="datetime-local"
            value={value}
            onChange={(e) =>
              setSlots((prev) => prev.map((v, j) => (j === i ? e.target.value : v)))
            }
            className="h-8 w-auto text-xs"
          />
        ))}
        <Button size="sm" disabled={pending} onClick={submit}>
          {pending ? "Offering…" : "Offer times"}
        </Button>
      </div>
      {error && <p className="text-xs text-red-600">{error}</p>}
    </div>
  );
}

/** Add a catalogue workup item the age/sex auto-seed skipped. */
function AddWorkup({ review }: { review: AnnualReviewWithContext }) {
  const queryClient = useQueryClient();
  const catalogue = useWorkupCatalogue();
  const [code, setCode] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const present = new Set(review.workup_items.map((w) => w.code));
  const options = (catalogue.data ?? []).filter((c) => !present.has(c.code));
  if (options.length === 0) return null;

  const submit = async () => {
    if (!code) return;
    setPending(true);
    setError(null);
    const result = await addWorkupItem(review.id, code);
    setPending(false);
    if (result && "error" in result) {
      setError(result.error);
      return;
    }
    setCode("");
    queryClient.invalidateQueries({ queryKey: ["annual-reviews"] });
  };

  return (
    <div className="flex flex-wrap items-center gap-2">
      <Select
        value={code}
        onChange={(e) => setCode(e.target.value)}
        className="h-8 text-xs"
      >
        <option value="">Add a workup item…</option>
        {options.map((c) => (
          <option key={c.code} value={c.code}>
            {c.label}
          </option>
        ))}
      </Select>
      <Button size="sm" variant="outline" disabled={pending || !code} onClick={submit}>
        Add
      </Button>
      {error && <p className="text-xs text-red-600">{error}</p>}
    </div>
  );
}

function ReviewCard({ review }: { review: AnnualReviewWithContext }) {
  const advance = useAdvanceAnnualReviewStage();
  const complete = useCompleteAnnualReview();
  const [summary, setSummary] = useState(review.year_summary ?? "");
  const overdue = new Date(review.due_date) < new Date(new Date().toDateString());

  const markStage = (stageKey: string, column: string) => {
    advance.mutate({
      reviewId: review.id,
      patch: {
        [column]: new Date().toISOString(),
        current_stage: stageKey as AnnualReviewWithContext["current_stage"],
        status: "in_progress",
      },
    });
  };

  const sortedWorkup = [...review.workup_items].sort((a, b) => a.label.localeCompare(b.label));

  return (
    <Card>
      <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-2">
        <CardTitle className="text-base">
          {review.patient?.full_name ?? "Patient"}
          {review.patient?.patient_number ? ` · ${review.patient.patient_number}` : ""}
        </CardTitle>
        <div className="flex items-center gap-2">
          <Badge variant="grey">{review.cycle_year}</Badge>
          <Badge variant={overdue ? "red" : "amber"}>
            {overdue ? "Overdue" : "Due"} {new Date(review.due_date).toLocaleDateString()}
          </Badge>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Ordered pathway */}
        <div>
          <p className="mb-1 text-xs font-medium uppercase tracking-wide text-charcoal-ink/50">
            Pathway
          </p>
          <div className="flex flex-wrap gap-1.5">
            {STAGES.map((stage) => {
              const done = Boolean(review[stage.column]);
              return (
                <Button
                  key={stage.key}
                  size="sm"
                  variant={done ? "outline" : "default"}
                  disabled={done || advance.isPending}
                  onClick={() => markStage(stage.key, stage.column)}
                >
                  {done ? `✓ ${stage.label}` : stage.label}
                </Button>
              );
            })}
          </div>
        </div>

        {/* General workup checklist */}
        <div>
          <p className="mb-1 text-xs font-medium uppercase tracking-wide text-charcoal-ink/50">
            General workup (beyond condition reviews)
          </p>
          <ul className="divide-y divide-charcoal-ink/5">
            {sortedWorkup.map((item) => (
              <WorkupRow key={item.id} item={item} />
            ))}
          </ul>
          <div className="mt-2">
            <AddWorkup review={review} />
          </div>
        </div>

        {/* Video consult scheduling handshake */}
        <ConsultProposer review={review} />

        {/* Year summary + complete */}
        <div className="space-y-1.5">
          <Label htmlFor={`summary_${review.id}`} className="text-xs">
            Year summary (discussed on the video consult)
          </Label>
          <Textarea
            id={`summary_${review.id}`}
            value={summary}
            onChange={(e) => setSummary(e.target.value)}
            rows={2}
            className="text-sm"
          />
          <Button
            size="sm"
            disabled={complete.isPending}
            onClick={() =>
              complete.mutate({ reviewId: review.id, yearSummary: summary.trim() || null })
            }
          >
            {complete.isPending ? "Completing…" : "Complete annual review"}
          </Button>
          {complete.isError && (
            <p className="text-xs text-red-600">
              {(complete.error as Error).message || "Could not complete this review."}
            </p>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

export default function AnnualReviewsPage() {
  const { data, isLoading, isError } = useOrgAnnualReviews();

  return (
    <div className="mx-auto max-w-3xl space-y-4 p-6">
      <div>
        <Link href="/clinician" className="text-sm text-brand-green hover:underline">
          ← Back to dashboard
        </Link>
        <h1 className="mt-2 text-xl font-semibold text-charcoal-ink">Annual health reviews</h1>
        <p className="text-sm text-charcoal-ink/70">
          Whole-body annual reviews for subscribed patients. Completing the medication-review stage
          adopts and rolls each patient&apos;s condition medication reviews — no double review.
        </p>
      </div>

      {isLoading && <p className="text-sm text-charcoal-ink/60">Loading…</p>}
      {isError && <p className="text-sm text-red-600">Could not load annual reviews.</p>}
      {data && data.length === 0 && (
        <p className="text-sm text-charcoal-ink/60">No open annual reviews.</p>
      )}
      {data?.map((review) => (
        <ReviewCard key={review.id} review={review} />
      ))}
    </div>
  );
}
