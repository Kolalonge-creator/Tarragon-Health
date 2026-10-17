"use client";

import { useActionState, useEffect, useState, useTransition } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  useOrgSecondOpinionRequests,
  useMarkSecondOpinionInReview,
  secondOpinionKeys,
  type SecondOpinionRequestWithPatient,
} from "@/lib/queries/second-opinion";
import { answerSecondOpinionRequest, readSharedResults, type AnswerSecondOpinionState } from "./actions";
import {
  SECOND_OPINION_SPECIALIST_TYPES,
  SPECIALIST_TYPE_LABEL,
  type SecondOpinionRead,
} from "@/lib/validation/second-opinion";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";

function formatValue(i: SecondOpinionRead["results"][number]["items"][number]): string {
  const value = i.value_numeric !== null ? String(i.value_numeric) : (i.value_text ?? "");
  const range = i.ref_low !== null || i.ref_high !== null ? ` (range ${i.ref_low ?? "…"} to ${i.ref_high ?? "…"})` : "";
  return `${value} ${i.unit}${range}`.trim();
}

/** The results the patient chose to share for this request. Opening them is an audited read in the database. */
function SharedResults({ requestId }: { requestId: string }) {
  const [pending, start] = useTransition();
  const [read, setRead] = useState<SecondOpinionRead | null>(null);
  const [error, setError] = useState<string | null>(null);
  return (
    <div className="space-y-2">
      {!read && (
        <Button
          size="sm"
          type="button"
          variant="outline"
          disabled={pending}
          onClick={() =>
            start(async () => {
              const r = await readSharedResults(requestId);
              if (r.data) {
                setRead(r.data);
                setError(null);
              } else {
                setError(r.error ?? "Could not open the shared results.");
              }
            })
          }
        >
          {pending ? "Opening…" : "View results the patient shared"}
        </Button>
      )}
      {error && <p className="text-xs text-red-600">{error}</p>}
      {read && read.results.length === 0 && (
        <p className="text-xs text-charcoal-ink/60">The patient did not share any Tarragon results.</p>
      )}
      {read?.results.map((res) => (
        <div key={res.id} className="rounded-md border border-charcoal-ink/10 p-2">
          <p className="text-xs font-medium text-charcoal-ink">
            {res.panel_code ?? "Lab result"} · {new Date(res.received_at).toLocaleDateString()}
          </p>
          <ul className="mt-1 space-y-0.5">
            {res.items.map((i) => (
              <li key={i.analyte_code} className="text-xs text-charcoal-ink/80">
                {i.analyte_code}: {formatValue(i)}
                {i.flag !== "normal" && i.flag !== "negative" ? ` · ${i.flag}` : ""}
              </li>
            ))}
          </ul>
        </div>
      ))}
    </div>
  );
}

function RequestRow({ request }: { request: SecondOpinionRequestWithPatient }) {
  const [refer, setRefer] = useState(false);
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
      <SharedResults requestId={request.id} />
      <form action={formAction} className="space-y-2">
        <input type="hidden" name="request_id" value={request.id} />
        <Textarea
          name="answer"
          rows={4}
          placeholder="Your assessment, written for the patient, not for the notes."
        />
        <label className="flex items-center gap-2 text-xs text-charcoal-ink">
          <input type="checkbox" name="refer" checked={refer} onChange={(e) => setRefer(e.target.checked)} />
          Recommend a specialist referral (the patient accepts it, then downloads the letter)
        </label>
        {refer && (
          <div className="space-y-2 rounded-md border border-charcoal-ink/10 p-2">
            <select name="specialist_type" className="w-full rounded-md border border-charcoal-ink/20 p-2 text-sm" defaultValue="" required>
              <option value="" disabled>
                Specialty
              </option>
              {SECOND_OPINION_SPECIALIST_TYPES.map((t) => (
                <option key={t} value={t}>
                  {SPECIALIST_TYPE_LABEL[t]}
                </option>
              ))}
            </select>
            <select name="urgency" className="w-full rounded-md border border-charcoal-ink/20 p-2 text-sm" defaultValue="routine">
              <option value="routine">Routine</option>
              <option value="priority">Priority</option>
              <option value="urgent">Urgent</option>
            </select>
            <Textarea name="referral_reason" rows={3} placeholder="Reason for the referral, as it should read on the letter." />
            <input
              name="requested_service"
              className="w-full rounded-md border border-charcoal-ink/20 p-2 text-sm"
              placeholder="What you are asking the specialist to do (optional)"
            />
          </div>
        )}
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
