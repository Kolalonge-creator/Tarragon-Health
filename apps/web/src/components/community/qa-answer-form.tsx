"use client";

import { useId, useState } from "react";
import { Button } from "@/components/ui/button";
import { QA_ANSWER_MAX, QA_ANSWER_MIN } from "./qa-limits";
import type { StaffActionResult } from "./staff-types";
import { StaffMessage, useStaffAction } from "./use-staff-action";


/** One answer to one question. A general answer for everyone in the group, never advice for one person. */
export function QaAnswerForm({ postId, onAnswer }: { postId: string; onAnswer: (input: { postId: string; body: string }) => Promise<StaffActionResult> }) {
  const uid = useId();
  const [body, setBody] = useState("");
  const [error, setError] = useState<string | null>(null);
  const { message, pending, run } = useStaffAction();
  const length = body.trim().length;

  return (
    <form
      className="space-y-2"
      onSubmit={(e) => {
        e.preventDefault();
        if (length < QA_ANSWER_MIN || length > QA_ANSWER_MAX) return setError(`Please write between ${QA_ANSWER_MIN} and ${QA_ANSWER_MAX} characters.`);
        setError(null);
        run(
          () => onAnswer({ postId, body }),
          (r) => {
            if (r.ok) setBody("");
          },
        );
      }}
    >
      <label htmlFor={`${uid}-a`} className="block text-sm font-medium text-charcoal-ink">
        Your answer
      </label>
      <textarea
        id={`${uid}-a`}
        rows={4}
        maxLength={QA_ANSWER_MAX}
        value={body}
        onChange={(e) => setBody(e.target.value)}
        aria-describedby={`${uid}-h`}
        className="w-full rounded-lg border border-charcoal-ink/20 bg-white px-3 py-2 text-sm text-charcoal-ink"
      />
      <p id={`${uid}-h`} className="text-xs text-charcoal-ink/70">
        {QA_ANSWER_MIN} to {QA_ANSWER_MAX} characters ({length} so far). Your answer shows your name.
      </p>
      {error && (
        <p role="alert" className="text-sm text-red-700">
          {error}
        </p>
      )}
      <Button type="submit" size="sm" disabled={pending}>
        {pending ? "Saving..." : "Post answer"}
      </Button>
      <StaffMessage message={message} />
    </form>
  );
}
