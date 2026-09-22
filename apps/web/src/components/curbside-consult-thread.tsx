"use client";

import { useState } from "react";
import {
  useCurbsideConsultMessages,
  usePostCurbsideConsultMessage,
  type CurbsideConsultMessage,
} from "@/lib/queries/curbside-consults";
import { DOCTOR_TIER_LABEL } from "@/lib/clinical/doctor-tier";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { FormError, fieldErrorId, fieldErrorProps } from "@/components/ui/form-error";

function when(iso: string): string {
  return new Date(iso).toLocaleString("en-GB", {
    timeZone: "Africa/Lagos",
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function senderLabel(message: CurbsideConsultMessage, myClinicalStaffId: string): string {
  if (!message.sender) return "Colleague";
  const name = message.sender_clinical_staff_id === myClinicalStaffId ? `You` : `Dr. ${message.sender.full_name}`;
  const tier = message.sender.doctor_tier ? DOCTOR_TIER_LABEL[message.sender.doctor_tier] : null;
  return tier ? `${name} · ${tier}` : name;
}

/** The message thread for one curbside consult — mirrors CareMessageThread's
 * bubble/compose shape (components/care-message-thread.tsx), simplified for
 * a two-party, no-attachment, no-template channel. */
export function CurbsideConsultThread({
  threadId,
  myClinicalStaffId,
  closed,
}: {
  threadId: string;
  myClinicalStaffId: string;
  closed: boolean;
}) {
  const { data: messages, isLoading } = useCurbsideConsultMessages(threadId);
  const post = usePostCurbsideConsultMessage();
  const [body, setBody] = useState("");
  const [error, setError] = useState<string | null>(null);
  const replyFieldId = `curbside-consult-reply-${threadId}`;
  const replyErrorId = fieldErrorId(replyFieldId);

  const send = () => {
    setError(null);
    post.mutate(
      { threadId, body },
      {
        onSuccess: () => setBody(""),
        onError: () => setError("We could not send that just then. Please try again."),
      },
    );
  };

  return (
    <div className="space-y-3">
      {isLoading && <p className="text-sm text-charcoal-ink/60 dark:text-night-ink/60">Loading…</p>}
      <ul className="space-y-3">
        {(messages ?? []).map((message) => {
          const mine = message.sender_clinical_staff_id === myClinicalStaffId;
          return (
            <li
              key={message.id}
              className={
                mine
                  ? "rounded-lg border border-brand-green/20 dark:border-brand-green/30 bg-brand-green/5 dark:bg-brand-green/10 p-3"
                  : "rounded-lg border border-charcoal-ink/10 dark:border-night-ink/15 bg-white dark:bg-night-card p-3"
              }
            >
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="text-xs font-medium text-charcoal-ink/70 dark:text-night-ink/70">
                  {senderLabel(message, myClinicalStaffId)}
                </span>
                <span className="text-xs text-charcoal-ink/50 dark:text-night-ink/55">
                  {when(message.created_at)}
                </span>
              </div>
              <p className="mt-1 whitespace-pre-wrap text-sm text-charcoal-ink dark:text-night-ink">
                {message.body}
              </p>
            </li>
          );
        })}
      </ul>

      {closed ? (
        <p className="text-sm text-charcoal-ink/50 dark:text-night-ink/55">This consult is closed.</p>
      ) : (
        <div className="space-y-3">
          <label htmlFor={replyFieldId} className="sr-only">
            Your reply
          </label>
          <Textarea
            id={replyFieldId}
            value={body}
            onChange={(e) => setBody(e.target.value)}
            placeholder="Write a reply…"
            rows={3}
            maxLength={4000}
            {...fieldErrorProps(replyErrorId, Boolean(error))}
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
            <FormError id={replyErrorId} message={error} />
          </div>
        </div>
      )}
    </div>
  );
}
