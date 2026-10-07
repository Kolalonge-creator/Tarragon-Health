"use client";

import { useState, useTransition } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import {
  CORRECTION_OUTCOMES,
  type CorrectionOutcome,
  type NoteActionState,
  type NoteRequests,
} from "@/lib/clinician/note-requests";
import {
  decideNoteRelease,
  loadMyNoteRequests,
  respondNoteCorrection,
} from "../patients/[patientId]/note-actions";

const QUERY_KEY = ["my-note-requests"] as const;

const OUTCOME_LABEL: Record<CorrectionOutcome, string> = {
  accepted: "Accept (an amendment draft is started)",
  annotated: "Annotate (keep the note, add the patient's view)",
  declined: "Decline (with your reason)",
};

const dateTime = (v: string): string => new Date(v).toLocaleString("en-GB", { dateStyle: "medium", timeStyle: "short" });

function ReleaseRow({ noteId, requestedAt, isProtected, onDone }: { noteId: string; requestedAt: string; isProtected: boolean; onDone: () => void }) {
  const [reason, setReason] = useState("");
  const [state, setState] = useState<NoteActionState>();
  const [pending, start] = useTransition();
  const run = (release: boolean) =>
    start(async () => {
      const result = await decideNoteRelease({ noteId, release, reason });
      setState(result);
      if (result?.message) onDone();
    });
  return (
    <li className="space-y-2 py-3">
      <div className="flex flex-wrap items-center gap-2 text-sm text-charcoal-ink">
        <span>A patient asked to open a signed note. Requested {dateTime(requestedAt)}.</span>
        {isProtected && <Badge variant="amber">Protected: Chief Medical Officer only</Badge>}
      </div>
      <Label htmlFor={`withhold-${noteId}`}>Reason (required if you withhold)</Label>
      <Textarea id={`withhold-${noteId}`} rows={2} value={reason} onChange={(e) => setReason(e.target.value)} maxLength={1000} />
      {state?.error && <p role="alert" className="text-sm text-red-600">{state.error}</p>}
      {state?.message && <p className="text-sm text-brand-green">{state.message}</p>}
      <div className="flex gap-2">
        <Button size="sm" disabled={pending} onClick={() => run(true)}>Release</Button>
        <Button size="sm" variant="outline" disabled={pending} onClick={() => run(false)}>Withhold</Button>
      </div>
    </li>
  );
}

function CorrectionRow({ id, text, dueAt, onDone }: { id: string; text: string; dueAt: string | null; onDone: () => void }) {
  const [outcome, setOutcome] = useState<CorrectionOutcome>("annotated");
  const [response, setResponse] = useState("");
  const [state, setState] = useState<NoteActionState>();
  const [pending, start] = useTransition();
  return (
    <li className="space-y-2 py-3">
      <p className="text-sm text-charcoal-ink">The patient asked for a correction{dueAt ? `. Reply by ${dateTime(dueAt)}` : ""}:</p>
      <p className="whitespace-pre-wrap rounded-md bg-charcoal-ink/5 p-2 text-sm text-charcoal-ink">{text}</p>
      <div>
        <Label htmlFor={`outcome-${id}`}>Your decision</Label>
        <Select id={`outcome-${id}`} value={outcome} onChange={(e) => setOutcome(e.target.value as CorrectionOutcome)}>
          {CORRECTION_OUTCOMES.map((o) => (
            <option key={o} value={o}>{OUTCOME_LABEL[o]}</option>
          ))}
        </Select>
      </div>
      <div>
        <Label htmlFor={`response-${id}`}>Response to the patient (required)</Label>
        <Textarea id={`response-${id}`} rows={3} value={response} onChange={(e) => setResponse(e.target.value)} maxLength={2000} />
      </div>
      {state?.error && <p role="alert" className="text-sm text-red-600">{state.error}</p>}
      {state?.message && <p className="text-sm text-brand-green">{state.message}</p>}
      <Button
        size="sm"
        disabled={pending}
        onClick={() =>
          start(async () => {
            const result = await respondNoteCorrection({ requestId: id, outcome, response });
            setState(result);
            if (result?.message) onDone();
          })
        }
      >
        Send response
      </Button>
    </li>
  );
}

/** Patients' requests to open a signed note, and their correction requests, that are waiting on me. */
export function NoteRequestsPanel() {
  const queryClient = useQueryClient();
  const { data, isLoading } = useQuery({
    queryKey: QUERY_KEY,
    queryFn: async (): Promise<{ requests?: NoteRequests; error?: string }> => loadMyNoteRequests(),
  });
  const refresh = () => queryClient.invalidateQueries({ queryKey: QUERY_KEY });
  const requests = data?.requests;
  const empty = requests && requests.releases.length === 0 && requests.corrections.length === 0;

  return (
    <Card>
      <CardHeader>
        <CardTitle>Patient requests about notes</CardTitle>
      </CardHeader>
      <CardContent>
        {isLoading && <p className="text-sm text-charcoal-ink/60">Loading...</p>}
        {data?.error && <p role="alert" className="text-sm text-red-600">{data.error}</p>}
        {empty && <p className="text-sm text-charcoal-ink/60">No requests are waiting for you.</p>}
        {requests && !empty && (
          <ul className="divide-y divide-charcoal-ink/10">
            {requests.releases.map((r) => (
              <ReleaseRow key={r.note_id} noteId={r.note_id} requestedAt={r.requested_at} isProtected={r.is_protected} onDone={refresh} />
            ))}
            {requests.corrections.map((c) => (
              <CorrectionRow key={c.id} id={c.id} text={c.request_text} dueAt={c.due_at} onDone={refresh} />
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
