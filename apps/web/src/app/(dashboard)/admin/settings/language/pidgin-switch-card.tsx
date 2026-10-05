"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { setPidginSwitchAction } from "./actions";

export function PidginSwitchCard({
  isOn,
  changedAt,
  changeNote,
}: {
  isOn: boolean;
  changedAt: string | null;
  changeNote: string | null;
}) {
  const [note, setNote] = useState("");
  const [feedback, setFeedback] = useState<{ error?: string; message?: string } | null>(null);
  const [pending, startTransition] = useTransition();
  const router = useRouter();

  // One click: no confirmation step, no required reason. Switching off is the
  // emergency direction and must be as quick as possible; it is fully reversible.
  function flip() {
    const formData = new FormData();
    formData.set("on", String(!isOn));
    formData.set("note", note);
    startTransition(async () => {
      const result = await setPidginSwitchAction(undefined, formData);
      setFeedback(result ?? null);
      if (!result?.error) setNote("");
      router.refresh();
    });
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          Nigerian Pidgin
          <Badge variant={isOn ? "green" : "grey"}>{isOn ? "On" : "Off, English only"}</Badge>
        </CardTitle>
        <CardDescription>
          Switch Pidgin off and every screen on web and mobile, signed in and signed out, shows English at once.
          Nobody&apos;s saved choice is lost: switch it back on and people who picked Pidgin get it again. Clinical,
          emergency, dosing and consent text is English whatever this is set to.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        {feedback?.error && <p className="rounded-md bg-red-50 px-4 py-2 text-sm text-red-700">{feedback.error}</p>}
        {feedback?.message && (
          <p className="rounded-md bg-green-50 px-4 py-2 text-sm text-green-700">{feedback.message}</p>
        )}
        {changedAt && (
          <p className="text-sm text-charcoal-ink/70">
            Last changed {new Date(changedAt).toLocaleString()}
            {changeNote ? `: ${changeNote}` : ""}
          </p>
        )}
        <Textarea
          aria-label="Reason (optional)"
          placeholder="What was wrong or what changed (optional)"
          value={note}
          onChange={(e) => setNote(e.target.value)}
          rows={2}
        />
        <Button variant={isOn ? "outline" : "default"} disabled={pending} onClick={flip}>
          {pending ? "Saving…" : isOn ? "Turn Pidgin off" : "Turn Pidgin on"}
        </Button>
        <p className="text-xs text-charcoal-ink/60">
          Phones pick this up within a few minutes. Reminders already scheduled on a phone keep their wording until the
          app next refreshes them.
        </p>
      </CardContent>
    </Card>
  );
}
