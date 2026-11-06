"use client";

import { useState } from "react";
import { useEscalationContactAttempts, useLogContactAttempt } from "@/lib/queries/escalations";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";

const OUTCOME_LABEL: Record<string, string> = {
  reached: "Reached the patient",
  no_answer: "No answer",
  left_message: "Left a message",
  wrong_number: "Wrong number",
  declined: "Patient declined to talk",
};

function formatLagos(iso: string): string {
  return new Date(iso).toLocaleString("en-GB", {
    timeZone: "Africa/Lagos",
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
}

/**
 * DW-13: each attempt to reach the patient on this case. The assigned doctor, the CMO or a care coordinator can log one; logging
 * never changes the case (public.log_escalation_contact_attempt only inserts an attempt).
 */
export function ContactAttemptsPanel({
  escalationId,
  canLog,
}: {
  escalationId: string;
  /** The case is still open and the viewer may log (the RPC is the real gate). */
  canLog: boolean;
}) {
  const { data: attempts, isLoading, isError } = useEscalationContactAttempts(escalationId);
  const log = useLogContactAttempt();
  const [outcome, setOutcome] = useState("no_answer");
  const [note, setNote] = useState("");

  return (
    <Card>
      <CardHeader>
        <CardTitle>Attempts to reach the patient</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {isLoading ? (
          <p className="text-sm text-charcoal-ink/60">Loading…</p>
        ) : isError ? (
          <p className="text-sm text-red-600">Could not load contact attempts. Refresh to try again.</p>
        ) : attempts && attempts.length > 0 ? (
          <ul className="space-y-2">
            {attempts.map((a) => (
              <li key={a.id} className="text-sm text-charcoal-ink">
                <span className="font-medium">{OUTCOME_LABEL[a.outcome] ?? a.outcome}</span>
                <span className="text-charcoal-ink/60">
                  {" "}
                  · {formatLagos(a.attempted_at)}
                  {a.attempted_by_name ? ` · ${a.attempted_by_name}` : ""}
                </span>
                {a.note && <p className="text-charcoal-ink/80">{a.note}</p>}
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-sm text-charcoal-ink/60">No attempts logged yet.</p>
        )}

        {canLog && (
          <div className="space-y-3 border-t border-charcoal-ink/10 pt-4">
            <div className="space-y-2">
              <Label htmlFor="contact-outcome">Outcome</Label>
              <Select id="contact-outcome" value={outcome} onChange={(e) => setOutcome(e.target.value)}>
                {Object.entries(OUTCOME_LABEL).map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </Select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="contact-note">Note (optional)</Label>
              <Input
                id="contact-note"
                value={note}
                maxLength={1000}
                onChange={(e) => setNote(e.target.value)}
                placeholder="Number tried, what was said"
              />
            </div>
            {log.isError && (
              <p className="text-sm text-red-600" role="alert">
                {log.error?.message || "Could not save. Try again."}
              </p>
            )}
            <Button
              variant="outline"
              disabled={log.isPending}
              onClick={() => log.mutate({ escalationId, outcome, note }, { onSuccess: () => setNote("") })}
            >
              Log attempt
            </Button>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
