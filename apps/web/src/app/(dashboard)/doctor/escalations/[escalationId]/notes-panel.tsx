"use client";

import { useState } from "react";
import { useEscalationNotes, useAddEscalationNote } from "@/lib/queries/escalations";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";

export function NotesPanel({
  escalationId,
  organisationId,
}: {
  escalationId: string;
  organisationId: string;
}) {
  const { data: notes, isLoading } = useEscalationNotes(escalationId);
  const addNote = useAddEscalationNote();
  const [note, setNote] = useState("");
  const [nextFollowUpAt, setNextFollowUpAt] = useState("");

  return (
    <Card>
      <CardHeader>
        <CardTitle>Call notes</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="space-y-2">
          <Label htmlFor="note">New note</Label>
          <Input
            id="note"
            placeholder="What happened on this contact attempt?"
            value={note}
            onChange={(e) => setNote(e.target.value)}
          />
          <Label htmlFor="next-follow-up-at">Next follow-up (optional)</Label>
          <Input
            id="next-follow-up-at"
            type="datetime-local"
            value={nextFollowUpAt}
            onChange={(e) => setNextFollowUpAt(e.target.value)}
          />
          <Button
            size="sm"
            disabled={addNote.isPending || note.trim().length === 0}
            onClick={() => {
              addNote.mutate(
                {
                  escalationId,
                  organisationId,
                  note: note.trim(),
                  nextFollowUpAt: nextFollowUpAt
                    ? new Date(nextFollowUpAt).toISOString()
                    : undefined,
                },
                {
                  onSuccess: () => {
                    setNote("");
                    setNextFollowUpAt("");
                  },
                }
              );
            }}
          >
            Add note
          </Button>
        </div>

        {isLoading && <p className="text-sm text-charcoal-ink/60">Loading…</p>}
        {notes && notes.length === 0 && (
          <p className="text-sm text-charcoal-ink/60">No call notes yet.</p>
        )}
        {notes && notes.length > 0 && (
          <ul className="divide-y divide-charcoal-ink/10">
            {notes.map((entry) => (
              <li key={entry.id} className="space-y-1 py-2">
                <p className="text-sm text-charcoal-ink">{entry.note}</p>
                <p className="text-xs text-charcoal-ink/60">
                  {entry.author?.full_name ?? "Unknown"} ·{" "}
                  {new Date(entry.created_at).toLocaleString()}
                  {entry.next_follow_up_at &&
                    ` · Next follow-up: ${new Date(entry.next_follow_up_at).toLocaleString()}`}
                </p>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
