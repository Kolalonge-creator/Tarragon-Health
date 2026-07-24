"use client";

import { useActionState, useEffect } from "react";
import Link from "next/link";
import { useQueryClient } from "@tanstack/react-query";
import {
  useOrgAsyncConsults,
  useMarkConsultInReview,
  asyncConsultKeys,
  type AsyncConsultWithPatient,
} from "@/lib/queries/async-consults";
import { ASYNC_CONSULT_CATEGORIES } from "@/lib/validation/async-consults";
import { answerAsyncConsult, type AnswerConsultState } from "./actions";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";

const CATEGORY_LABEL = Object.fromEntries(
  ASYNC_CONSULT_CATEGORIES.map((c) => [c.value, c.label])
);

function ConsultRow({ consult }: { consult: AsyncConsultWithPatient }) {
  const markInReview = useMarkConsultInReview();
  const queryClient = useQueryClient();
  const [state, formAction, isPending] = useActionState<AnswerConsultState, FormData>(
    answerAsyncConsult,
    undefined
  );

  useEffect(() => {
    if (state?.message) {
      queryClient.invalidateQueries({ queryKey: asyncConsultKeys.org });
    }
  }, [state?.message, queryClient]);

  const overdue = consult.sla_due_at && new Date(consult.sla_due_at) < new Date();

  return (
    <li className="space-y-2 py-3">
      <div className="flex flex-wrap items-center gap-2">
        <p className="text-sm font-medium text-charcoal-ink">
          {consult.patient?.full_name ?? "Patient"}
          {consult.patient?.patient_number ? ` · ${consult.patient.patient_number}` : ""}
        </p>
        <Badge variant="blue">{CATEGORY_LABEL[consult.category] ?? consult.category}</Badge>
        {consult.status === "in_review" && <Badge variant="amber">In review</Badge>}
        {overdue && <Badge variant="red">SLA passed</Badge>}
      </div>
      <p className="text-sm text-charcoal-ink">{consult.question}</p>
      {consult.duration_note && (
        <p className="text-xs text-charcoal-ink/60">Going on for: {consult.duration_note}</p>
      )}
      {consult.sla_due_at && (
        <p className="text-xs text-charcoal-ink/60">
          Respond by {new Date(consult.sla_due_at).toLocaleString()}
        </p>
      )}
      {consult.status === "submitted" && (
        <Button
          size="sm"
          variant="outline"
          disabled={markInReview.isPending}
          onClick={() => markInReview.mutate(consult.id)}
        >
          Start review
        </Button>
      )}
      <form action={formAction} className="space-y-2">
        <input type="hidden" name="consult_id" value={consult.id} />
        <Textarea
          name="answer"
          rows={3}
          placeholder="Your answer to the patient — written for them, not for the chart."
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

export default function AsyncConsultsPage() {
  const { data, isLoading, isError } = useOrgAsyncConsults();

  return (
    <div className="mx-auto max-w-3xl space-y-4 p-6">
      <div>
        <Link href="/clinician" className="text-sm text-brand-green hover:underline">
          ← Back to dashboard
        </Link>
      </div>
      <Card>
        <CardHeader>
          <CardTitle>Ask-a-doctor consults</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="mb-3 text-xs text-charcoal-ink/60">
            Written patient questions with a 24-hour response promise, soonest deadline
            first. Your answer is stamped with your own clinical record — it renders to the
            patient as &quot;Answered by Dr. you&quot;.
          </p>
          {isLoading && <p className="text-sm text-charcoal-ink/60">Loading…</p>}
          {isError && <p className="text-sm text-red-600">Could not load consults.</p>}
          {data && data.length === 0 && (
            <p className="text-sm text-charcoal-ink/60">Nothing waiting — no open questions.</p>
          )}
          {data && data.length > 0 && (
            <ul className="divide-y divide-charcoal-ink/10">
              {data.map((c) => (
                <ConsultRow key={c.id} consult={c} />
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
