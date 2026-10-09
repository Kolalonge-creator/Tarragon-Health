"use client";

import { useId, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { ReviewedLine } from "@/components/community/reviewed-line";
import { StaffMessage, useStaffAction } from "@/components/community/use-staff-action";
import type { StaffActionResult } from "@/components/community/staff-types";

export interface NoteRow {
  id: string;
  title: string;
  body: string;
  authored_by_name: string | null;
  reviewed_by_name: string | null;
  reviewed_at: string | null;
  /** True when the signed-in clinician wrote it. A clinician cannot review their own note. */
  is_mine: boolean;
}

export function NotesPanel({
  groupId,
  notes,
  onPin,
  onReview,
}: {
  groupId: string;
  notes: NoteRow[];
  onPin: (input: { groupId: string; title: string; body: string }) => Promise<StaffActionResult>;
  onReview: (input: { id: string }) => Promise<StaffActionResult>;
}) {
  const uid = useId();
  const { message, pending, run } = useStaffAction();
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [fieldError, setFieldError] = useState<string | null>(null);

  const waiting = notes.filter((n) => !n.is_mine && !(n.reviewed_by_name && n.reviewed_at));
  const others = notes.filter((n) => n.is_mine || (n.reviewed_by_name && n.reviewed_at));

  function save() {
    if (title.trim().length === 0 || body.trim().length === 0) {
      setFieldError("Please give the note a title and some text.");
      return;
    }
    setFieldError(null);
    run(
      () => onPin({ groupId, title: title.trim(), body: body.trim() }),
      (r) => {
        if (r.ok) {
          setTitle("");
          setBody("");
        }
      },
    );
  }

  return (
    <div className="space-y-4">
      <StaffMessage message={message} />

      <fieldset className="space-y-2 rounded-md border border-charcoal-ink/15 p-3">
        <legend className="px-1 text-sm font-medium">Write a note for this group</legend>
        <p className="text-sm text-charcoal-ink/70">
          A note is shown to members only after a different clinician has reviewed it. You cannot review your own note.
        </p>
        <label htmlFor={`${uid}-t`} className="block text-sm">
          Title
        </label>
        <Input id={`${uid}-t`} value={title} onChange={(e) => setTitle(e.target.value)} />
        <label htmlFor={`${uid}-b`} className="block text-sm">
          Note
        </label>
        <Textarea id={`${uid}-b`} rows={5} value={body} onChange={(e) => setBody(e.target.value)} />
        {fieldError && (
          <p role="alert" className="text-sm text-red-700">
            {fieldError}
          </p>
        )}
        <Button size="sm" disabled={pending} onClick={save}>
          Save note
        </Button>
      </fieldset>

      <section aria-labelledby={`${uid}-w`} className="space-y-2">
        <h3 id={`${uid}-w`} className="text-sm font-semibold text-charcoal-ink">
          Notes waiting for your review
        </h3>
        {waiting.length === 0 ? (
          <p className="text-sm text-charcoal-ink/70">No notes from other clinicians are waiting.</p>
        ) : (
          <ul className="space-y-3">
            {waiting.map((n) => (
              <li key={n.id} className="space-y-2 rounded-md border border-charcoal-ink/10 bg-white p-3">
                <p className="text-sm font-semibold">{n.title}</p>
                <p className="whitespace-pre-wrap break-words text-sm">{n.body}</p>
                <p className="text-xs text-charcoal-ink/60">Written by {n.authored_by_name ?? "a clinician"}</p>
                <div className="flex flex-wrap items-center gap-3">
                  <ReviewedLine reviewedByName={n.reviewed_by_name} reviewedAt={n.reviewed_at} />
                  <Button size="sm" disabled={pending} onClick={() => run(() => onReview({ id: n.id }))}>
                    Review this note
                  </Button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section aria-labelledby={`${uid}-o`} className="space-y-2">
        <h3 id={`${uid}-o`} className="text-sm font-semibold text-charcoal-ink">
          Your notes and reviewed notes
        </h3>
        {others.length === 0 ? (
          <p className="text-sm text-charcoal-ink/70">Nothing here yet.</p>
        ) : (
          <ul className="space-y-3">
            {others.map((n) => (
              <li key={n.id} className="space-y-1 rounded-md border border-charcoal-ink/10 bg-white p-3">
                <p className="text-sm font-semibold">
                  {n.title} {n.is_mine && <span className="font-normal text-charcoal-ink/60">(written by you)</span>}
                </p>
                <p className="whitespace-pre-wrap break-words text-sm">{n.body}</p>
                <ReviewedLine reviewedByName={n.reviewed_by_name} reviewedAt={n.reviewed_at} />
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
