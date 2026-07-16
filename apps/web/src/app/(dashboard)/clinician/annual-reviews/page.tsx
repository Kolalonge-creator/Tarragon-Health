"use client";

import { useState } from "react";
import Link from "next/link";
import {
  useOrgAnnualReviews,
  useAdvanceAnnualReviewStage,
  useCompleteAnnualReview,
  useUpdateWorkupItem,
  type AnnualReviewWithContext,
  type AnnualReviewWorkupItem,
} from "@/lib/queries/annual-reviews";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select } from "@/components/ui/select";

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
        </div>

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
