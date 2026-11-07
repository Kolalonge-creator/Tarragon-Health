"use client";

import { useState } from "react";
import {
  usePatientDueCheckins,
  useRespondToCheckin,
  checkinQuestion,
  type AdherenceCheckinWithDrug,
} from "@/lib/queries/adherence-checkins";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { raiseMedicationNotSureTask } from "./medication-not-sure-actions";

/** The stored answer when the patient picks "Not sure". */
export const NOT_SURE_ANSWER = "Not sure";

function CheckinRow({ checkin, patientId }: { checkin: AdherenceCheckinWithDrug; patientId: string }) {
  const respond = useRespondToCheckin(patientId);
  const [answer, setAnswer] = useState("");
  const [notSurePending, setNotSurePending] = useState(false);
  const [notSureError, setNotSureError] = useState<string | null>(null);

  // P16 (CMO decision from chat, 2026-11-07): "Not sure" first raises one routine task on the medicine-issue worklist,
  // then records the answer. If the task cannot be raised, the answer is not recorded, so the question stays and can be retried.
  async function answerNotSure() {
    setNotSurePending(true);
    setNotSureError(null);
    const r = await raiseMedicationNotSureTask({ source: "checkin", checkinId: checkin.id });
    setNotSurePending(false);
    if (!r.ok) {
      setNotSureError(r.error);
      return;
    }
    respond.mutate({ checkinId: checkin.id, response: NOT_SURE_ANSWER });
  }

  return (
    <li className="space-y-2 py-3">
      <p className="text-sm text-charcoal-ink dark:text-night-ink">
        {checkinQuestion(checkin.checkin_type, checkin.medication?.drug_name ?? undefined)}
      </p>
      <div className="flex flex-wrap items-end gap-2">
        <Input
          value={answer}
          onChange={(event) => setAnswer(event.target.value)}
          placeholder="Your answer"
          className="h-9 min-w-48 flex-1 text-sm"
        />
        <Button
          size="sm"
          variant="outline"
          disabled={respond.isPending || !answer.trim()}
          onClick={() => respond.mutate({ checkinId: checkin.id, response: answer.trim() })}
        >
          {respond.isPending ? "Sending…" : "Send"}
        </Button>
        <Button size="sm" variant="ghost" disabled={respond.isPending || notSurePending} onClick={answerNotSure}>
          Not sure
        </Button>
      </div>
      {notSureError && (
        <p role="alert" className="text-xs text-red-600 dark:text-red-300">{notSureError}</p>
      )}
      {respond.isError && (
        <p className="text-xs text-red-600 dark:text-red-300">Could not save your answer. Try again.</p>
      )}
    </li>
  );
}

export function AdherenceCheckins({ patientId }: { patientId: string }) {
  const { data, isLoading, isError } = usePatientDueCheckins(patientId);

  // Only surface the card when there's something to answer.
  if (!isLoading && !isError && (!data || data.length === 0)) return null;

  return (
    <Card>
      <CardHeader>
        <CardTitle>Medication check-in</CardTitle>
      </CardHeader>
      <CardContent>
        {isLoading && <p className="text-sm text-charcoal-ink/60 dark:text-night-ink/60">Loading…</p>}
        {isError && <p className="text-sm text-red-600 dark:text-red-300">Could not load your check-ins.</p>}
        {data && data.length > 0 && (
          <ul className="divide-y divide-charcoal-ink/10 dark:divide-night-ink/15">
            {data.map((checkin) => (
              <CheckinRow key={checkin.id} checkin={checkin} patientId={patientId} />
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
