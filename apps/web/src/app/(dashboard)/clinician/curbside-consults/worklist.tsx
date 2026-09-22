"use client";

import { useState } from "react";
import {
  useCurbsideConsultThreads,
  useCurbsideConsultColleagues,
  useStartCurbsideConsult,
  useCloseCurbsideConsult,
  type CurbsideConsultThread,
} from "@/lib/queries/curbside-consults";
import { CurbsideConsultThread as CurbsideConsultThreadView } from "@/components/curbside-consult-thread";
import { DOCTOR_TIER_LABEL } from "@/lib/clinical/doctor-tier";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { FormError, fieldErrorId, fieldErrorProps } from "@/components/ui/form-error";

function when(iso: string): string {
  return new Date(iso).toLocaleString("en-GB", {
    timeZone: "Africa/Lagos",
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
}

/** "The other person" from this reader's point of view — a curbside consult
 * has exactly two participants, so whichever one isn't me is who to show. */
function otherParty(thread: CurbsideConsultThread, myClinicalStaffId: string) {
  return thread.initiator_clinical_staff_id === myClinicalStaffId ? thread.recipient : thread.initiator;
}

function isAwaitingMyReply(thread: CurbsideConsultThread, myClinicalStaffId: string): boolean {
  return (
    thread.status === "open" &&
    thread.last_message_sender_id !== null &&
    thread.last_message_sender_id !== myClinicalStaffId
  );
}

function NewConsultForm({ onStarted }: { onStarted: () => void }) {
  const { data: colleagues } = useCurbsideConsultColleagues();
  const start = useStartCurbsideConsult();
  const [recipientId, setRecipientId] = useState("");
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");
  const [error, setError] = useState<string | null>(null);
  const bodyFieldId = "curbside-consult-new-body";
  const bodyErrorId = fieldErrorId(bodyFieldId);

  const submit = () => {
    setError(null);
    if (!recipientId) {
      setError("Choose who you're asking.");
      return;
    }
    if (subject.trim().length === 0 || body.trim().length === 0) {
      setError("A subject and a question are both required.");
      return;
    }
    start.mutate(
      { recipientClinicalStaffId: recipientId, subject, body },
      {
        onSuccess: () => {
          setRecipientId("");
          setSubject("");
          setBody("");
          onStarted();
        },
        onError: (err) => setError(err instanceof Error ? err.message : "Could not start the consult."),
      },
    );
  };

  return (
    <div className="space-y-3 rounded-lg border border-charcoal-ink/10 dark:border-night-ink/15 bg-charcoal-ink/[0.02] dark:bg-night-ink/[0.04] p-4">
      <div>
        <label htmlFor="curbside-consult-recipient" className="text-xs font-medium text-charcoal-ink/70 dark:text-night-ink/70">
          Ask
        </label>
        <select
          id="curbside-consult-recipient"
          className="mt-1 block w-full rounded-md border border-charcoal-ink/20 dark:border-night-ink/25 bg-white dark:bg-night-card px-2 py-1.5 text-sm text-charcoal-ink dark:text-night-ink"
          value={recipientId}
          onChange={(e) => setRecipientId(e.target.value)}
        >
          <option value="">Choose a colleague…</option>
          {(colleagues ?? []).map((c) => (
            <option key={c.id} value={c.id}>
              Dr. {c.full_name}
              {c.doctor_tier ? ` — ${DOCTOR_TIER_LABEL[c.doctor_tier]}` : ""}
            </option>
          ))}
        </select>
      </div>
      <div>
        <label htmlFor="curbside-consult-subject" className="text-xs font-medium text-charcoal-ink/70 dark:text-night-ink/70">
          Subject
        </label>
        <Input
          id="curbside-consult-subject"
          value={subject}
          onChange={(e) => setSubject(e.target.value)}
          placeholder="e.g. Resistant hypertension, 4th-line question"
          maxLength={200}
          className="mt-1"
        />
      </div>
      <div>
        <label htmlFor={bodyFieldId} className="text-xs font-medium text-charcoal-ink/70 dark:text-night-ink/70">
          Your question
        </label>
        <Textarea
          id={bodyFieldId}
          value={body}
          onChange={(e) => setBody(e.target.value)}
          rows={3}
          maxLength={4000}
          className="mt-1"
          {...fieldErrorProps(bodyErrorId, Boolean(error))}
        />
      </div>
      <div className="flex items-center gap-3">
        <Button type="button" size="sm" disabled={start.isPending} onClick={submit}>
          {start.isPending ? "Sending…" : "Ask colleague"}
        </Button>
        <FormError id={bodyErrorId} message={error} />
      </div>
    </div>
  );
}

function ThreadRow({ thread, myClinicalStaffId }: { thread: CurbsideConsultThread; myClinicalStaffId: string }) {
  const [open, setOpen] = useState(false);
  const close = useCloseCurbsideConsult();
  const other = otherParty(thread, myClinicalStaffId);
  const awaiting = isAwaitingMyReply(thread, myClinicalStaffId);

  return (
    <li className="py-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <button type="button" className="text-left" onClick={() => setOpen((v) => !v)}>
          <span className={awaiting ? "font-semibold text-charcoal-ink" : "font-medium text-charcoal-ink"}>
            {thread.subject}
          </span>
          <span className="ml-2 text-sm text-charcoal-ink/60">
            {other ? `with Dr. ${other.full_name}` : "with a colleague"}
          </span>
        </button>
        <span className="flex items-center gap-2">
          {awaiting && <Badge variant="amber">Your turn to reply</Badge>}
          <Badge variant={thread.status === "open" ? "amber" : "grey"}>
            {thread.status === "open" ? "Open" : "Closed"}
          </Badge>
          <span className="text-xs text-charcoal-ink/50">{when(thread.last_message_at)}</span>
        </span>
      </div>
      {open && (
        <div className="mt-3 space-y-3">
          <CurbsideConsultThreadView
            threadId={thread.id}
            myClinicalStaffId={myClinicalStaffId}
            closed={thread.status === "closed"}
          />
          {thread.status === "open" && (
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={close.isPending}
              onClick={() => close.mutate(thread.id)}
            >
              {close.isPending ? "Closing…" : "Close consult"}
            </Button>
          )}
        </div>
      )}
    </li>
  );
}

export function CurbsideConsultWorklist({ myClinicalStaffId }: { myClinicalStaffId: string }) {
  const { data: threads, isLoading, isError } = useCurbsideConsultThreads();
  const [showNewConsult, setShowNewConsult] = useState(false);

  const open = (threads ?? []).filter((t) => t.status === "open");
  const closed = (threads ?? []).filter((t) => t.status === "closed");
  const awaitingCount = open.filter((t) => isAwaitingMyReply(t, myClinicalStaffId)).length;

  return (
    <Card>
      <CardHeader className="flex flex-col gap-3 space-y-0 md:flex-row md:items-center md:justify-between">
        <div>
          <CardTitle>Curbside consults</CardTitle>
          <p className="mt-1 text-sm text-charcoal-ink/60">
            {awaitingCount === 0
              ? "A quick, informal question to a colleague — not part of the patient's chart."
              : `${awaitingCount} waiting on your reply.`}
          </p>
        </div>
        <Button type="button" size="sm" onClick={() => setShowNewConsult((v) => !v)}>
          {showNewConsult ? "Cancel" : "Ask a colleague"}
        </Button>
      </CardHeader>
      <CardContent>
        {showNewConsult && (
          <div className="mb-6">
            <NewConsultForm onStarted={() => setShowNewConsult(false)} />
          </div>
        )}
        {isLoading && <p className="text-sm text-charcoal-ink/60">Loading…</p>}
        {isError && <p className="text-sm text-red-600">Could not load curbside consults.</p>}
        {!isLoading && !isError && (!threads || threads.length === 0) && (
          <p className="text-sm text-charcoal-ink/60">
            No curbside consults yet. Ask a colleague a quick clinical question above.
          </p>
        )}
        {open.length > 0 && (
          <ul className="divide-y divide-charcoal-ink/10">
            {open.map((thread) => (
              <ThreadRow key={thread.id} thread={thread} myClinicalStaffId={myClinicalStaffId} />
            ))}
          </ul>
        )}
        {closed.length > 0 && (
          <>
            <p className="mt-6 mb-1 text-xs font-medium uppercase tracking-wide text-charcoal-ink/50">Closed</p>
            <ul className="divide-y divide-charcoal-ink/10">
              {closed.map((thread) => (
                <ThreadRow key={thread.id} thread={thread} myClinicalStaffId={myClinicalStaffId} />
              ))}
            </ul>
          </>
        )}
      </CardContent>
    </Card>
  );
}
