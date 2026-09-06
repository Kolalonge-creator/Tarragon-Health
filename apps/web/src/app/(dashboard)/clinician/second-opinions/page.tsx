"use client";

import { useActionState, useEffect } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  useOrgSecondOpinionRequests,
  useMarkSecondOpinionInReview,
  secondOpinionKeys,
  type SecondOpinionRequestWithPatient,
} from "@/lib/queries/second-opinion";
import { answerSecondOpinionRequest, type AnswerSecondOpinionState } from "./actions";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";

function RequestRow({ request }: { request: SecondOpinionRequestWithPatient }) {
  const markInReview = useMarkSecondOpinionInReview();
  const queryClient = useQueryClient();
  const [state, formAction, isPending] = useActionState<AnswerSecondOpinionState, FormData>(
    answerSecondOpinionRequest,
    undefined
  );

  useEffect(() => {
    if (state?.message) {
      queryClient.invalidateQueries({ queryKey: secondOpinionKeys.org });
    }
  }, [state?.message, queryClient]);

  const overdue = request.sla_due_at && new Date(request.sla_due_at) < new Date();

  return (
    <li className="space-y-2 py-3">
      <div className="flex flex-wrap items-center gap-2">
        <p className="text-sm font-medium text-charcoal-ink">
          {request.patient?.full_name ?? "Patient"}
          {request.patient?.patient_number ? ` · ${request.patient.patient_number}` : ""}
        </p>
        {request.status === "in_review" && <Badge variant="amber">In review</Badge>}
        {overdue && <Badge variant="red">SLA passed</Badge>}
      </div>
      <p className="text-sm text-charcoal-ink">{request.existing_diagnosis_or_result}</p>
      {request.source_description && (
        <p className="text-xs text-charcoal-ink/60">Source: {request.source_description}</p>
      )}
      {request.specific_question && (
        <p className="text-xs text-charcoal-ink/60">Patient&apos;s question: {request.specific_question}</p>
      )}
      {request.sla_due_at && (
        <p className="text-xs text-charcoal-ink/60">
          Respond by {new Date(request.sla_due_at).toLocaleString()}
        </p>
      )}
      {request.status === "submitted" && (
        <Button
          size="sm"
          variant="outline"
          disabled={markInReview.isPending}
          onClick={() => markInReview.mutate(request.id)}
        >
          Start review
        </Button>
      )}
      <form action={formAction} className="space-y-2">
        <input type="hidden" name="request_id" value={request.id} />
        <Textarea
          name="answer"
          rows={4}
          placeholder="Your assessment, written for the patient, not for the chart."
        />
        {state?.error && <p className="text-xs text-red-600">{state.error}</p>}
        {state?.message && <p className="text-xs text-brand-green">{state.message}</p>}
        <Button size="sm" type="submit" disabled={isPending}>
          {isPending ? "Sending…" : "Send answer"}
        </Button>
      </form>
    </li>
  );
}

export default function SecondOpinionsPage() {
  const { data, isLoading, isError } = useOrgSecondOpinionRequests();

  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-heading text-2xl font-semibold text-charcoal-ink">Second opinions</h1>
        <p className="text-sm text-charcoal-ink/60">
          Paid second-opinion requests awaiting your review. Each one already carries a redeemed
          credit, no billing action needed here.
        </p>
      </div>
      <Card>
        <CardHeader>
          <CardTitle>Requests</CardTitle>
        </CardHeader>
        <CardContent>
          {isLoading && <p className="text-sm text-charcoal-ink/60">Loading…</p>}
          {isError && <p className="text-sm text-red-600">Could not load requests.</p>}
          {data && data.length === 0 && (
            <p className="text-sm text-charcoal-ink/60">Nothing waiting.</p>
          )}
          {data && data.length > 0 && (
            <ul className="divide-y divide-charcoal-ink/10">
              {data.map((r) => (
                <RequestRow key={r.id} request={r} />
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
