"use client";

import { useState } from "react";
import { useThreadMessages, usePostMessage, type CareMessage } from "@/lib/queries/care-messages";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";

function when(iso: string): string {
  return new Date(iso).toLocaleString("en-GB", {
    timeZone: "Africa/Lagos",
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function authorLabel(message: CareMessage): string {
  if (message.author_role === "patient") return "Patient";
  // Null-gated clinician attribution: only name a doctor when a real
  // clinical_staff row backs the message.
  if (message.actor?.full_name) {
    const credential =
      message.actor.credential_type && message.actor.credential_number
        ? ` · ${message.actor.credential_type} ${message.actor.credential_number}`
        : "";
    return `Dr. ${message.actor.full_name}${credential}`;
  }
  return "Care team";
}

export function CareMessageThread({
  threadId,
  closed,
}: {
  threadId: string;
  closed: boolean;
}) {
  const { data: messages, isLoading } = useThreadMessages(threadId);
  const post = usePostMessage();
  const [body, setBody] = useState("");
  const [error, setError] = useState<string | null>(null);

  const send = () => {
    setError(null);
    post.mutate(
      { threadId, body },
      {
        onSuccess: () => setBody(""),
        onError: (err) => setError(err instanceof Error ? err.message : "Couldn't send"),
      },
    );
  };

  return (
    <div className="space-y-3">
      {isLoading && <p className="text-sm text-charcoal-ink/60">Loading…</p>}
      <ul className="space-y-3">
        {(messages ?? []).map((message) => (
          <li
            key={message.id}
            className={
              message.author_role === "patient"
                ? "rounded-lg border border-charcoal-ink/10 bg-white p-3"
                : "rounded-lg border border-brand-green/20 bg-brand-green/5 p-3"
            }
          >
            <div className="flex items-center justify-between gap-2">
              <span className="text-xs font-medium text-charcoal-ink/70">
                {authorLabel(message)}
              </span>
              <span className="text-xs text-charcoal-ink/50">{when(message.created_at)}</span>
            </div>
            <p className="mt-1 whitespace-pre-wrap text-sm text-charcoal-ink">{message.body}</p>
          </li>
        ))}
      </ul>

      {closed ? (
        <p className="text-sm text-charcoal-ink/50">This conversation is closed.</p>
      ) : (
        <div className="space-y-2">
          <Textarea
            value={body}
            onChange={(e) => setBody(e.target.value)}
            placeholder="Write a reply…"
            rows={3}
            maxLength={4000}
          />
          <div className="flex items-center gap-3">
            <Button
              type="button"
              size="sm"
              disabled={post.isPending || body.trim().length === 0}
              onClick={send}
            >
              {post.isPending ? "Sending…" : "Send"}
            </Button>
            {error && <span className="text-sm text-red-600">{error}</span>}
          </div>
        </div>
      )}
    </div>
  );
}
