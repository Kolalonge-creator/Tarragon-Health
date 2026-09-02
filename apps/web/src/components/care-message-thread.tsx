"use client";

import { useState } from "react";
import { useThreadMessages, usePostMessage, type CareMessage } from "@/lib/queries/care-messages";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { isClinicalTier } from "@/lib/clinical/doctor-tier";

function when(iso: string): string {
  return new Date(iso).toLocaleString("en-GB", {
    timeZone: "Africa/Lagos",
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
}

/**
 * Who said it.
 *
 * A thread can now carry three voices — the patient, their care team, and a
 * supporter the patient has consented to — so every message names its author
 * rather than relying on the reader inferring it from the styling. The name
 * itself comes from author_display, frozen server-side at insert: a patient
 * cannot read their own supporter's profile row, so resolving names at render
 * time would show "someone" against their own daughter's question.
 */
function authorLabel(message: CareMessage): string {
  // Null-gated clinician attribution: only name a doctor when a real
  // clinical_staff row backs the message AND it's an actual clinical tier —
  // a Care Coordinator's own active clinical_staff row (doctor_tier =
  // 'care_coordinator') must never render as "Dr. <coordinator's name>".
  if (message.author_role === "care_team") {
    if (message.actor?.full_name && isClinicalTier(message.actor)) {
      const credential =
        message.actor.credential_type && message.actor.credential_number
          ? ` · ${message.actor.credential_type} ${message.actor.credential_number}`
          : "";
      return `Dr. ${message.actor.full_name}${credential}`;
    }
    return "Care team";
  }
  if (message.author_role === "sponsor") {
    return message.author_display ?? "Someone who supports them";
  }
  return message.author_display ?? "Patient";
}

/** A plain word for the seat someone is speaking from, next to their name. */
function roleLabel(message: CareMessage): string | null {
  if (message.author_role === "sponsor") return "Supporting them";
  if (message.author_role === "patient") return "Patient";
  return null;
}

const BUBBLE: Record<string, string> = {
  patient: "rounded-lg border border-charcoal-ink/10 bg-white p-3",
  care_team: "rounded-lg border border-brand-green/20 bg-brand-green/5 p-3",
  sponsor: "rounded-lg border border-clinical-navy/20 bg-clinical-navy/5 p-3",
};

export function CareMessageThread({
  threadId,
  closed,
  showEmergencyNotice = false,
}: {
  threadId: string;
  closed: boolean;
  /** Messaging boundaries (17.11): this channel is read by the care team
   * during normal hours, not watched continuously — a patient composing
   * here needs to know that before they rely on it for something urgent.
   * Opt-in per caller so the clinician worklist (where staff are the ones
   * reading, not relying on a reply) stays unchanged. */
  showEmergencyNotice?: boolean;
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
            className={BUBBLE[message.author_role] ?? BUBBLE.patient}
          >
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className="text-xs font-medium text-charcoal-ink/70">
                {authorLabel(message)}
                {roleLabel(message) && (
                  <span className="ml-1 font-normal text-charcoal-ink/50">
                    · {roleLabel(message)}
                  </span>
                )}
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
          {showEmergencyNotice && (
            <p className="rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-900">
              Your care team reads messages here during working hours — this isn&apos;t a monitored
              emergency line. If something feels urgent right now, use the emergency guidance on
              your dashboard instead of waiting for a reply here.
            </p>
          )}
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
