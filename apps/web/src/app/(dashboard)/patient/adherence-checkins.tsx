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

function CheckinRow({ checkin, patientId }: { checkin: AdherenceCheckinWithDrug; patientId: string }) {
  const respond = useRespondToCheckin(patientId);
  const [answer, setAnswer] = useState("");

  return (
    <li className="space-y-2 py-3">
      <p className="text-sm text-charcoal-ink">
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
      </div>
      {respond.isError && (
        <p className="text-xs text-red-600">Could not save your answer. Try again.</p>
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
        {isLoading && <p className="text-sm text-charcoal-ink/60">Loading…</p>}
        {isError && <p className="text-sm text-red-600">Could not load your check-ins.</p>}
        {data && data.length > 0 && (
          <ul className="divide-y divide-charcoal-ink/10">
            {data.map((checkin) => (
              <CheckinRow key={checkin.id} checkin={checkin} patientId={patientId} />
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
