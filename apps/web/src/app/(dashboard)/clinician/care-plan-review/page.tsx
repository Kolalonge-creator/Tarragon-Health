"use client";

import Link from "next/link";
import {
  useOrgCarePlanReviewPrompts,
  useResolveCarePlanReviewPrompt,
  type CarePlanReviewPromptWithPatient,
} from "@/lib/queries/care-plan-review-prompts";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";

const TRIGGER_LABEL: Record<string, string> = {
  abnormal_lab_result: "Abnormal result",
  missed_medication: "Missed medication",
  new_diagnosis: "New diagnosis",
  risk_tier_change: "Risk tier change",
  hospital_discharge: "Hospital discharge",
};

function PromptRow({ prompt }: { prompt: CarePlanReviewPromptWithPatient }) {
  const resolve = useResolveCarePlanReviewPrompt();
  const pending = resolve.isPending;

  return (
    <li className="space-y-2 py-3">
      <div className="flex flex-wrap items-center gap-2">
        <p className="text-sm font-medium text-charcoal-ink">
          {prompt.patient?.full_name ?? "Patient"}
          {prompt.patient?.patient_number ? ` · ${prompt.patient.patient_number}` : ""}
        </p>
        <Badge variant="amber">
          {TRIGGER_LABEL[prompt.trigger_event_type] ?? prompt.trigger_event_type}
        </Badge>
      </div>
      <p className="text-xs text-charcoal-ink/70">{prompt.reason}</p>
      <div className="flex flex-wrap gap-2">
        {prompt.patient?.id && (
          <Button size="sm" variant="outline" asChild>
            <Link href={`/clinician/patients/${prompt.patient.id}`}>Review patient →</Link>
          </Button>
        )}
        <Button
          size="sm"
          disabled={pending}
          onClick={() => resolve.mutate({ promptId: prompt.id, status: "actioned" })}
        >
          {pending ? "Saving…" : "Mark reviewed"}
        </Button>
        <Button
          size="sm"
          variant="outline"
          disabled={pending}
          onClick={() => resolve.mutate({ promptId: prompt.id, status: "dismissed" })}
        >
          Dismiss
        </Button>
      </div>
      {resolve.isError && (
        <p className="text-xs text-red-600">
          {(resolve.error as Error)?.message ?? "Could not update this prompt."}
        </p>
      )}
    </li>
  );
}

export default function CarePlanReviewPage() {
  const { data, isLoading, isError } = useOrgCarePlanReviewPrompts();

  return (
    <div className="mx-auto max-w-3xl space-y-4 p-6">
      <div>
        <Link href="/clinician" className="text-sm text-brand-green hover:underline">
          ← Back to dashboard
        </Link>
      </div>
      <Card>
        <CardHeader>
          <CardTitle>Care plans that may need review</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="mb-4 text-xs text-charcoal-ink/60">
            Raised automatically when an abnormal result, a missed-medication escalation, a new
            diagnosis, a risk-tier change, or a hospital discharge suggests a patient&apos;s care
            plan may be stale. This never edits a care plan itself — open the patient to make any
            change, then mark the prompt reviewed.
          </p>
          {isLoading && <p className="text-sm text-charcoal-ink/60">Loading…</p>}
          {isError && (
            <p className="text-sm text-red-600">Could not load care-plan review prompts.</p>
          )}
          {data && data.length === 0 && (
            <p className="text-sm text-charcoal-ink/60">Nothing waiting — you&apos;re all caught up.</p>
          )}
          {data && data.length > 0 && (
            <ul className="divide-y divide-charcoal-ink/10">
              {data.map((prompt) => (
                <PromptRow key={prompt.id} prompt={prompt} />
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
