"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { answerPharmacyQuestion } from "@/lib/pharmacy-collection/actions";
import { ANSWER_TEXT, answerText, questionText, type PrescriberOverview } from "@/lib/pharmacy-collection/collection";

function when(iso: string | null): string {
  return iso ? new Date(iso).toLocaleString("en-NG", { timeZone: "Africa/Lagos", dateStyle: "medium", timeStyle: "short" }) : "";
}

type Question = PrescriberOverview["questions"][number];

function QuestionRow({ q }: { q: Question }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function answer(code: string) {
    setError(null);
    startTransition(async () => {
      const r = await answerPharmacyQuestion({ questionId: q.question_id, answer: code });
      if (!r.ok) {
        setError(r.error);
        return;
      }
      router.refresh();
    });
  }

  return (
    <li className="space-y-2 py-3">
      <p className="text-sm font-medium">
        {q.patient_name ?? "Patient"}: {q.medicines.join(", ")}
      </p>
      <p className="text-sm">
        {q.pharmacy_name} asks: {questionText(q.reason_code)}. <span className="text-charcoal-ink/60">{when(q.asked_at)}</span>
      </p>
      {q.answered_at ? (
        <p className="text-sm">
          <Badge>Answered</Badge> {answerText(q.answer_code)} <span className="text-charcoal-ink/60">{when(q.answered_at)}</span>
        </p>
      ) : (
        <div className="space-y-2">
          <div className="flex flex-wrap gap-2">
            {Object.entries(ANSWER_TEXT).map(([code, label]) => (
              <Button key={code} type="button" variant="outline" disabled={pending} onClick={() => answer(code)}>
                {label}
              </Button>
            ))}
          </div>
          <p className="text-xs text-charcoal-ink/70">
            An answer does not change the prescription. If the medicine or dose must change, write a new prescription the usual way.
          </p>
        </div>
      )}
      {error && (
        <p role="alert" className="text-sm text-red-700">
          {error}
        </p>
      )}
    </li>
  );
}

export function PharmacyQuestions({ overview }: { overview: PrescriberOverview }) {
  const open = overview.questions.filter((q) => !q.answered_at);
  const answered = overview.questions.filter((q) => q.answered_at);
  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>Questions from pharmacies</CardTitle>
        </CardHeader>
        <CardContent>
          {open.length === 0 ? (
            <p className="text-sm text-charcoal-ink/70">No pharmacy is waiting for an answer from you.</p>
          ) : (
            <ul className="divide-y divide-charcoal-ink/10">{open.map((q) => <QuestionRow key={q.question_id} q={q} />)}</ul>
          )}
          {answered.length > 0 && (
            <>
              <p className="mt-4 text-xs font-medium uppercase tracking-wide text-charcoal-ink/60">Answered in the last 30 days</p>
              <ul className="divide-y divide-charcoal-ink/10">{answered.map((q) => <QuestionRow key={q.question_id} q={q} />)}</ul>
            </>
          )}
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle>Where your prescriptions have got to</CardTitle>
        </CardHeader>
        <CardContent>
          {overview.collection.length === 0 ? (
            <p className="text-sm text-charcoal-ink/70">None of your recent prescriptions has been sent to a pharmacy.</p>
          ) : (
            <ul className="divide-y divide-charcoal-ink/10">
              {overview.collection.map((c) => (
                <li key={c.prescription_id} className="space-y-0.5 py-3">
                  <p className="text-sm font-medium">
                    {c.patient_name ?? "Patient"}: {c.medicines.join(", ")}
                  </p>
                  <p className="text-sm">
                    {c.state === "sent" ? `Waiting at ${c.pharmacy_name} since ${when(c.sent_at)}` : `Supplied by ${c.pharmacy_name} on ${when(c.dispensed_at)}`}
                  </p>
                </li>
              ))}
            </ul>
          )}
          <p className="mt-3 text-xs text-charcoal-ink/70">A patient may also take the downloaded prescription to any other pharmacy. That is not shown here.</p>
        </CardContent>
      </Card>
    </div>
  );
}
