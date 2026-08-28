"use client";

import { useState } from "react";
import {
  useOrgMedicationReviews,
  useCompleteMedicationReview,
  type MedicationReviewWithContext,
  type MedicationReviewEffectiveness,
} from "@/lib/queries/medication-reviews";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select } from "@/components/ui/select";
import { Input } from "@/components/ui/input";

const EFFECTIVENESS_LABEL: Record<MedicationReviewEffectiveness, string> = {
  effective: "Effective",
  partially_effective: "Partially effective",
  not_effective: "Not effective",
  too_early_to_tell: "Too early to tell",
};

function formatCondition(condition: string): string {
  return condition
    .split("_")
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
}

// A bare toLocaleDateString() resolves the server's locale on first render and
// the browser's on hydration, producing a mismatch. Fixed locale + timezone
// keeps server and client in sync.
function formatDueDate(value: string): string {
  return new Date(value).toLocaleDateString("en-GB", { timeZone: "Africa/Lagos" });
}

function ReviewRow({ review }: { review: MedicationReviewWithContext }) {
  const complete = useCompleteMedicationReview();
  const [notes, setNotes] = useState("");
  const [effectiveness, setEffectiveness] = useState<MedicationReviewEffectiveness | "">("");
  const [adherenceReviewed, setAdherenceReviewed] = useState(false);
  const [sideEffectsReviewed, setSideEffectsReviewed] = useState(false);
  const [affordabilityReviewed, setAffordabilityReviewed] = useState(false);
  const [affordabilityBarrier, setAffordabilityBarrier] = useState(false);
  const [monitoringReviewed, setMonitoringReviewed] = useState(false);
  const [ongoingIndication, setOngoingIndication] = useState<"" | "yes" | "no">("");
  const [patientPreference, setPatientPreference] = useState("");
  const overdue = new Date(review.due_date) < new Date(new Date().toDateString());

  function handleComplete() {
    complete.mutate({
      reviewId: review.id,
      notes: notes.trim() || null,
      effectivenessAssessment: effectiveness || null,
      adherenceReviewed,
      sideEffectsReviewed,
      affordabilityReviewed,
      affordabilityBarrierIdentified: affordabilityReviewed ? affordabilityBarrier : null,
      monitoringReviewed,
      ongoingIndicationConfirmed:
        ongoingIndication === "" ? null : ongoingIndication === "yes",
      patientPreferenceNotes: patientPreference.trim() || null,
    });
  }

  return (
    <li className="space-y-2 py-3">
      <div className="flex flex-wrap items-center gap-2">
        <p className="text-sm font-medium text-charcoal-ink">
          {review.patient?.full_name ?? "Patient"}
          {review.patient?.patient_number ? ` · ${review.patient.patient_number}` : ""}
        </p>
        {review.care_plan?.condition && (
          <Badge variant="green">{formatCondition(review.care_plan.condition)}</Badge>
        )}
        <Badge variant={overdue ? "red" : "amber"}>
          {overdue ? "Overdue" : "Due"} {formatDueDate(review.due_date)}
        </Badge>
      </div>

      {/* 13.11 — the seven domains a review should assess. All optional: a
          reviewer can still complete with just notes, as before. */}
      <div className="grid grid-cols-2 gap-x-4 gap-y-2 rounded-md border border-charcoal-ink/10 p-2.5">
        <div className="space-y-1">
          <Label htmlFor={`effectiveness_${review.id}`} className="text-xs">
            Effectiveness
          </Label>
          <Select
            id={`effectiveness_${review.id}`}
            value={effectiveness}
            onChange={(event) =>
              setEffectiveness(event.target.value as MedicationReviewEffectiveness | "")
            }
            className="h-8 text-xs"
          >
            <option value="">Not assessed</option>
            {(Object.keys(EFFECTIVENESS_LABEL) as MedicationReviewEffectiveness[]).map((value) => (
              <option key={value} value={value}>
                {EFFECTIVENESS_LABEL[value]}
              </option>
            ))}
          </Select>
        </div>
        <div className="space-y-1">
          <Label htmlFor={`ongoing_indication_${review.id}`} className="text-xs">
            Still clinically indicated?
          </Label>
          <Select
            id={`ongoing_indication_${review.id}`}
            value={ongoingIndication}
            onChange={(event) => setOngoingIndication(event.target.value as "" | "yes" | "no")}
            className="h-8 text-xs"
          >
            <option value="">Not assessed</option>
            <option value="yes">Yes</option>
            <option value="no">No</option>
          </Select>
        </div>
        <div className="col-span-2 flex flex-wrap gap-x-4 gap-y-1.5">
          <label className="flex items-center gap-1.5 text-xs text-charcoal-ink">
            <input
              type="checkbox"
              className="h-3.5 w-3.5"
              checked={adherenceReviewed}
              onChange={(event) => setAdherenceReviewed(event.target.checked)}
            />
            Adherence reviewed
          </label>
          <label className="flex items-center gap-1.5 text-xs text-charcoal-ink">
            <input
              type="checkbox"
              className="h-3.5 w-3.5"
              checked={sideEffectsReviewed}
              onChange={(event) => setSideEffectsReviewed(event.target.checked)}
            />
            Side effects reviewed
          </label>
          <label className="flex items-center gap-1.5 text-xs text-charcoal-ink">
            <input
              type="checkbox"
              className="h-3.5 w-3.5"
              checked={monitoringReviewed}
              onChange={(event) => setMonitoringReviewed(event.target.checked)}
            />
            Monitoring reviewed
          </label>
          <label className="flex items-center gap-1.5 text-xs text-charcoal-ink">
            <input
              type="checkbox"
              className="h-3.5 w-3.5"
              checked={affordabilityReviewed}
              onChange={(event) => setAffordabilityReviewed(event.target.checked)}
            />
            Affordability reviewed
          </label>
          {affordabilityReviewed && (
            <label className="flex items-center gap-1.5 text-xs text-amber-700">
              <input
                type="checkbox"
                className="h-3.5 w-3.5"
                checked={affordabilityBarrier}
                onChange={(event) => setAffordabilityBarrier(event.target.checked)}
              />
              Access/cost barrier identified
            </label>
          )}
        </div>
        <div className="col-span-2 space-y-1">
          <Label htmlFor={`patient_preference_${review.id}`} className="text-xs">
            Patient preference (optional)
          </Label>
          <Input
            id={`patient_preference_${review.id}`}
            value={patientPreference}
            onChange={(event) => setPatientPreference(event.target.value)}
            className="h-8 text-xs"
          />
        </div>
      </div>

      <div className="space-y-1">
        <Label htmlFor={`notes_${review.id}`} className="text-xs">
          Review notes (control, side effects, adherence, dose changes)
        </Label>
        <Textarea
          id={`notes_${review.id}`}
          value={notes}
          onChange={(event) => setNotes(event.target.value)}
          rows={2}
          className="text-sm"
        />
      </div>
      <Button size="sm" variant="outline" disabled={complete.isPending} onClick={handleComplete}>
        {complete.isPending ? "Completing…" : "Complete review"}
      </Button>
      {complete.isError && (
        <p className="text-xs text-red-600">
          {(complete.error as Error).message || "Could not complete this review."}
        </p>
      )}
    </li>
  );
}

export default function MedicationReviewsPage() {
  const { data, isLoading, isError } = useOrgMedicationReviews();

  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-heading text-2xl font-semibold text-charcoal-ink">Medication reviews</h1>
        <p className="text-sm text-charcoal-ink/60">
          Scheduled medication reviews and refill sign-offs.
        </p>
      </div>
      <Card>
        <CardHeader>
          <CardTitle>Medication reviews due</CardTitle>
        </CardHeader>
        <CardContent>
          {isLoading && <p className="text-sm text-charcoal-ink/60">Loading…</p>}
          {isError && (
            <p className="text-sm text-red-600">Could not load medication reviews.</p>
          )}
          {data && data.length === 0 && (
            <p className="text-sm text-charcoal-ink/60">
              No reviews are due right now. Reviews are scheduled automatically when a
              care plan is activated, at each condition&apos;s cadence.
            </p>
          )}
          {data && data.length > 0 && (
            <ul className="divide-y divide-charcoal-ink/10">
              {data.map((review) => (
                <ReviewRow key={review.id} review={review} />
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
