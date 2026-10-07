"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { loadReviewQueueAction, readSampleAction, recordReviewAction, type ReviewConversation, type ReviewQueueRow } from "./actions";

const CATEGORY_LABEL: Record<string, string> = {
  none: "No issue",
  incorrect_information: "Wrong information",
  missed_escalation: "Missed something urgent",
  dose_or_medicine_advice: "Dose or medicine advice",
  sensitive_result: "A sensitive result",
  tone: "Tone",
  other: "Something else",
};

export function AssistantReviewClient({ initial }: { initial: ReviewQueueRow[] }) {
  const [rows, setRows] = useState(initial);
  const [open, setOpen] = useState<string | null>(null);
  const [reason, setReason] = useState("");
  const [conversation, setConversation] = useState<ReviewConversation | null>(null);
  const [verdict, setVerdict] = useState("appropriate");
  const [category, setCategory] = useState("none");
  const [note, setNote] = useState("");
  const [error, setError] = useState<string | null>(null);

  async function reload() {
    const r = await loadReviewQueueAction();
    if (r.ok) setRows(r.rows);
  }

  async function openSample(id: string) {
    setError(null);
    const r = await readSampleAction({ id, reason });
    if (!r.ok) return setError(r.error);
    setConversation(r.conversation);
  }

  async function record(id: string) {
    setError(null);
    const r = await recordReviewAction({ id, verdict, category, note });
    if (!r.ok) return setError(r.error);
    setOpen(null);
    setConversation(null);
    setReason("");
    setNote("");
    await reload();
  }

  if (rows.length === 0) return <p className="text-sm">Nothing to review yet. The sample is drawn once a month.</p>;
  return (
    <ul className="space-y-3">
      {rows.map((row) => (
        <li key={row.id} className="rounded-md border border-charcoal-ink/15 dark:border-night-ink/20 p-3 text-sm">
          <div className="flex flex-wrap items-center gap-3">
            <span className="font-medium">{row.month.slice(0, 7)}</span>
            <span>{row.reported ? "Reported by a patient" : "Random sample"}</span>
            <span>Patient {row.patientRef}</span>
            <span>{row.turns} turn(s)</span>
            <span>{row.state === "reviewed" ? `Reviewed: ${row.verdict ?? ""}` : "Waiting"}</span>
            {row.state === "pending" && open !== row.id && (
              <Button type="button" size="sm" variant="outline" onClick={() => { setOpen(row.id); setConversation(null); setError(null); }}>
                Review
              </Button>
            )}
          </div>
          {open === row.id && (
            <div className="mt-3 space-y-3">
              {!conversation ? (
                <div className="flex flex-wrap items-end gap-2">
                  <label className="flex-1 text-xs">
                    Why are you reading this conversation? (recorded)
                    <Input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Monthly clinical review of the assistant" />
                  </label>
                  <Button type="button" size="sm" disabled={reason.trim().length < 10} onClick={() => void openSample(row.id)}>
                    Open
                  </Button>
                </div>
              ) : (
                <>
                  <div className="max-h-96 space-y-2 overflow-y-auto rounded-md bg-charcoal-ink/5 dark:bg-night-ink/10 p-3">
                    {conversation.messages.map((m, i) => (
                      <p key={i} className={m.role === "user" ? "text-right" : ""}>
                        <span className="text-xs uppercase text-charcoal-ink/50 dark:text-night-ink/50">{m.role === "user" ? "Patient" : "Assistant"}{m.tier && m.tier !== "routine" ? ` (${m.tier})` : ""}: </span>
                        {m.content}
                      </p>
                    ))}
                  </div>
                  <div className="flex flex-wrap items-end gap-2">
                    <label className="text-xs">
                      Verdict
                      <select className="ml-1 h-9 rounded-md border px-2 text-sm bg-white dark:bg-night-card" value={verdict} onChange={(e) => setVerdict(e.target.value)}>
                        <option value="appropriate">Appropriate</option>
                        <option value="needs_improvement">Needs improvement</option>
                        <option value="unsafe">Unsafe</option>
                      </select>
                    </label>
                    <label className="text-xs">
                      Issue
                      <select className="ml-1 h-9 rounded-md border px-2 text-sm bg-white dark:bg-night-card" value={category} onChange={(e) => setCategory(e.target.value)}>
                        {Object.entries(CATEGORY_LABEL).map(([k, v]) => (
                          <option key={k} value={k}>{v}</option>
                        ))}
                      </select>
                    </label>
                    <label className="min-w-48 flex-1 text-xs">
                      Note (needed for unsafe)
                      <Input value={note} onChange={(e) => setNote(e.target.value)} />
                    </label>
                    <Button type="button" size="sm" onClick={() => void record(row.id)}>
                      Record review
                    </Button>
                  </div>
                </>
              )}
              {error && <p role="alert" className="text-sm text-red-600 dark:text-red-300">{error}</p>}
            </div>
          )}
        </li>
      ))}
    </ul>
  );
}
