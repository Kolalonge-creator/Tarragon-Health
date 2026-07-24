"use client";

import { useState } from "react";
import {
  useMyAsyncConsults,
  useSubmitAsyncConsult,
  type AsyncConsultWithAnswerer,
} from "@/lib/queries/async-consults";
import {
  asyncConsultSchema,
  ASYNC_CONSULT_CATEGORIES,
} from "@/lib/validation/async-consults";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";

function ConsultRow({ consult }: { consult: AsyncConsultWithAnswerer }) {
  const answered = consult.status === "answered" || consult.status === "closed";
  const credential =
    consult.answerer?.credential_type && consult.answerer?.credential_number
      ? `${consult.answerer.credential_type} ${consult.answerer.credential_number}`
      : null;

  return (
    <li className="space-y-1 py-3">
      <div className="flex flex-wrap items-center gap-2">
        <p className="text-sm font-medium text-charcoal-ink">{consult.question}</p>
        {answered ? (
          <Badge variant="green">Answered</Badge>
        ) : (
          <Badge variant="blue">With your care team</Badge>
        )}
      </div>
      {!answered && consult.sla_due_at && (
        <p className="text-xs text-charcoal-ink/60">
          A doctor will respond by {new Date(consult.sla_due_at).toLocaleString()}.
        </p>
      )}
      {answered && consult.answer && (
        <div className="rounded-lg border border-brand-green/20 bg-brand-green/[0.04] p-3">
          <p className="text-sm text-charcoal-ink">{consult.answer}</p>
          {/* Attribution is null-gated on the trigger-stamped answered_by record —
              never rendered without a real clinical_staff match. */}
          {consult.answerer && consult.answered_at && (
            <p className="mt-1 text-xs text-charcoal-ink/60">
              Answered by Dr. {consult.answerer.full_name}
              {credential ? ` (${credential})` : ""} on{" "}
              {new Date(consult.answered_at).toLocaleDateString()}
            </p>
          )}
        </div>
      )}
    </li>
  );
}

/**
 * "Ask a doctor" — the structured async visit (One Medical Treat-Me-Now on
 * Tarragon rails). Entirely in-app; WhatsApp support chat stays a separate,
 * human-routed channel. Deliberately NOT an emergency pathway — the red-flag
 * line below routes urgent symptoms to the existing danger-symptom flow.
 */
export function AskADoctor({
  patientId,
  organisationId,
}: {
  patientId: string;
  organisationId: string | null;
}) {
  const { data: consults } = useMyAsyncConsults(patientId);
  const submit = useSubmitAsyncConsult();
  const [category, setCategory] = useState<string>("general");
  const [question, setQuestion] = useState("");
  const [durationNote, setDurationNote] = useState("");
  const [formError, setFormError] = useState<string | null>(null);

  if (!organisationId) return null;

  const onSubmit = () => {
    setFormError(null);
    const parsed = asyncConsultSchema.safeParse({
      category,
      question,
      durationNote: durationNote || undefined,
    });
    if (!parsed.success) {
      setFormError(parsed.error.issues[0]?.message ?? "Check your question and try again");
      return;
    }
    submit.mutate(
      {
        patientId,
        organisationId,
        category: parsed.data.category,
        question: parsed.data.question,
        durationNote: parsed.data.durationNote,
      },
      {
        onSuccess: () => {
          setQuestion("");
          setDurationNote("");
        },
      }
    );
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>Ask a doctor</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <p className="text-sm text-charcoal-ink/70">
          Send a written question and a doctor on your care team answers here, usually
          within 24 hours. Not for emergencies: if something feels urgent, use the
          symptom check at the top of this page or go to a hospital.
        </p>
        <div className="space-y-2">
          <Label htmlFor="consult-category">What is it about?</Label>
          <Select
            id="consult-category"
            value={category}
            onChange={(e) => setCategory(e.target.value)}
          >
            {ASYNC_CONSULT_CATEGORIES.map((c) => (
              <option key={c.value} value={c.value}>
                {c.label}
              </option>
            ))}
          </Select>
        </div>
        <div className="space-y-2">
          <Label htmlFor="consult-question">Your question</Label>
          <Textarea
            id="consult-question"
            value={question}
            onChange={(e) => setQuestion(e.target.value)}
            rows={3}
            placeholder="e.g. I've felt dizzy in the mornings since my dose changed. Is that expected?"
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="consult-duration">How long has this been going on? (optional)</Label>
          <Select
            id="consult-duration"
            value={durationNote}
            onChange={(e) => setDurationNote(e.target.value)}
          >
            <option value="">Prefer not to say</option>
            <option value="today">Just today</option>
            <option value="days">A few days</option>
            <option value="weeks">A few weeks</option>
            <option value="longer">Longer</option>
          </Select>
        </div>
        {formError && <p className="text-sm text-red-600">{formError}</p>}
        {submit.isError && (
          <p className="text-sm text-red-600">Could not send your question. Try again.</p>
        )}
        {submit.isSuccess && (
          <p className="text-sm text-brand-green">
            Sent. A doctor will answer here within 24 hours.
          </p>
        )}
        <Button onClick={onSubmit} disabled={submit.isPending}>
          {submit.isPending ? "Sending…" : "Send to my care team"}
        </Button>

        {consults && consults.length > 0 && (
          <ul className="divide-y divide-charcoal-ink/10 border-t border-charcoal-ink/10">
            {consults.map((c) => (
              <ConsultRow key={c.id} consult={c} />
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
