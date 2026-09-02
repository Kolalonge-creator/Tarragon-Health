"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { SEMANTIC_ICON } from "@/lib/icons";
import { prepareForAppointmentAction } from "@/lib/appointment-prep/actions";

/**
 * "Not sure what to ask?" -- the appointment-prep sibling of ResultExplainer.
 * Same "AI-drafted, collapsed until asked" discipline: suggests questions
 * grounded in why the visit was booked, which the patient can add to their
 * own free-text notes above -- it never submits anything on its own.
 */
export function AppointmentPrepHelper({
  consultationId,
  onAddToNotes,
}: {
  consultationId: string;
  onAddToNotes: (question: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [isPending, setIsPending] = useState(false);
  const [result, setResult] = useState<{ status: "generated" | "failed"; questions: string[] } | null>(
    null
  );
  const [added, setAdded] = useState<Set<string>>(new Set());

  async function load() {
    setIsPending(true);
    try {
      setResult(await prepareForAppointmentAction(consultationId));
    } finally {
      setIsPending(false);
    }
  }

  if (!open) {
    return (
      <Button
        type="button"
        size="sm"
        variant="ghost"
        className="h-auto gap-1.5 px-0 text-xs text-brand-green hover:bg-transparent hover:underline"
        onClick={() => {
          setOpen(true);
          if (!result) void load();
        }}
      >
        <SEMANTIC_ICON.aiCoach className="h-3.5 w-3.5" aria-hidden />
        Not sure what to ask? Get help preparing questions
      </Button>
    );
  }

  return (
    <div className="space-y-2 rounded-md border border-mist-grey/60 bg-mist-grey/20 p-3">
      <Badge variant="grey">AI-drafted — questions to consider, not medical advice</Badge>

      {isPending && <p className="text-sm text-charcoal-ink/60">Thinking about what might be useful to ask…</p>}

      {!isPending && result?.status === "failed" && (
        <p className="text-sm text-charcoal-ink/60">
          Couldn&apos;t put together suggestions right now — you can still write your own notes above.
        </p>
      )}

      {!isPending && result?.status === "generated" && result.questions.length > 0 && (
        <ul className="space-y-1.5">
          {result.questions.map((question) => (
            <li key={question} className="flex items-start justify-between gap-2 text-sm text-charcoal-ink">
              <span>{question}</span>
              <Button
                type="button"
                size="sm"
                variant="outline"
                className="h-6 shrink-0 px-2 text-xs"
                disabled={added.has(question)}
                onClick={() => {
                  onAddToNotes(question);
                  setAdded((prev) => new Set(prev).add(question));
                }}
              >
                {added.has(question) ? "Added" : "Add"}
              </Button>
            </li>
          ))}
        </ul>
      )}

      <button
        type="button"
        className="text-xs text-charcoal-ink/40 hover:underline"
        onClick={() => setOpen(false)}
      >
        Hide
      </button>
    </div>
  );
}
