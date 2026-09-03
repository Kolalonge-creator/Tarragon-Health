"use client";

import { useEffect, useRef, useState } from "react";
import {
  useThreadMessages,
  usePostMessage,
  useMarkThreadRead,
  useCareMessageTemplates,
  useUploadCareMessageAttachment,
  type CareMessage,
  type CareMessageAttachment,
} from "@/lib/queries/care-messages";
import { validateCareMessageAttachment } from "@/lib/validation/care-messages";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { isClinicalTier } from "@/lib/clinical/doctor-tier";
import { DraftReplyCard } from "@/components/draft-reply-card";
import { NAV_ICON } from "@/lib/icons";

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
  patient: "rounded-lg border border-charcoal-ink/10 dark:border-night-ink/15 bg-white dark:bg-night-card p-3",
  care_team:
    "rounded-lg border border-brand-green/20 dark:border-brand-green/30 bg-brand-green/5 dark:bg-brand-green/10 p-3",
  sponsor:
    "rounded-lg border border-clinical-navy/20 dark:border-blue-500/30 bg-clinical-navy/5 dark:bg-blue-500/10 p-3",
};

function AttachmentChip({ attachment }: { attachment: CareMessageAttachment }) {
  return (
    <a
      href={`/api/care-messages/attachments/${attachment.id}`}
      target="_blank"
      rel="noopener noreferrer"
      className="inline-flex items-center gap-1.5 rounded-md border border-charcoal-ink/15 dark:border-night-ink/20 bg-white dark:bg-night-card px-2 py-1 text-xs text-charcoal-ink/70 dark:text-night-ink/70 hover:border-brand-green/40 hover:text-charcoal-ink dark:hover:text-night-ink"
    >
      <NAV_ICON.attachment className="h-3.5 w-3.5" strokeWidth={2} aria-hidden />
      <span className="max-w-[160px] truncate">{attachment.original_filename ?? "Attachment"}</span>
      <NAV_ICON.download className="h-3.5 w-3.5 shrink-0" strokeWidth={2} aria-hidden />
    </a>
  );
}

/** 77.7 — a template's body drops into the compose box, still fully
 * editable before sending. Staff-only (org-staff-authored replies); a
 * patient composing a message never sees this. */
function TemplatePicker({ onPick }: { onPick: (body: string) => void }) {
  const { data: templates } = useCareMessageTemplates();

  if (!templates || templates.length === 0) return null;

  return (
    <select
      aria-label="Use a template"
      className="h-8 rounded-md border border-charcoal-ink/15 dark:border-night-ink/20 bg-white dark:bg-night-card px-2 text-xs text-charcoal-ink/70 dark:text-night-ink/70"
      value=""
      onChange={(e) => {
        const picked = templates.find((t) => t.id === e.target.value);
        if (picked) onPick(picked.body);
      }}
    >
      <option value="" disabled>
        Use a template…
      </option>
      {templates.map((t) => (
        <option key={t.id} value={t.id}>
          {t.title}
        </option>
      ))}
    </select>
  );
}

export function CareMessageThread({
  threadId,
  patientId,
  closed,
  showDraftAssist = false,
  isStaff = false,
  showEmergencyNotice = false,
}: {
  threadId: string;
  patientId: string;
  closed: boolean;
  /** Renders the AI-drafted "Suggested reply" card above the compose box.
   * Staff-only surface (the underlying care_message_draft_replies table is
   * unreadable to a patient session via RLS) -- the patient-facing call
   * sites (messages-flow.tsx, supported-people.tsx) leave this unset. */
  showDraftAssist?: boolean;
  /** Renders the 77.7 template picker and skips the 77.10 attach control —
   * only a patient's own session can upload into their own storage folder
   * (see care-message-attachments.sql's storage policies). */
  isStaff?: boolean;
  /** Messaging boundaries (17.11): this channel is read by the care team
   * during normal hours, not watched continuously — a patient composing
   * here needs to know that before they rely on it for something urgent.
   * Opt-in per caller so the clinician worklist (where staff are the ones
   * reading, not relying on a reply) stays unchanged. */
  showEmergencyNotice?: boolean;
}) {
  const { data: messages, isLoading } = useThreadMessages(threadId);
  const post = usePostMessage();
  const markRead = useMarkThreadRead();
  const upload = useUploadCareMessageAttachment();
  const [body, setBody] = useState("");
  const [pendingFile, setPendingFile] = useState<File | null>(null);
  const [error, setError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // 77.13 — stamp this side's read clock whenever the thread is open, so an
  // unread clinical message doesn't stay "unread" once someone has actually
  // looked at it.
  useEffect(() => {
    markRead.mutate(threadId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [threadId]);

  const send = () => {
    setError(null);
    post.mutate(
      { threadId, body },
      {
        onSuccess: (messageId) => {
          setBody("");
          if (pendingFile) {
            upload.mutate(
              { messageId, threadId, patientId, file: pendingFile },
              { onError: (err) => setError(err instanceof Error ? err.message : "Message sent, but the file couldn't attach") },
            );
            setPendingFile(null);
          }
        },
        onError: (err) => setError(err instanceof Error ? err.message : "Couldn't send"),
      },
    );
  };

  const onFilePicked = (file: File | null) => {
    if (!file) {
      setPendingFile(null);
      return;
    }
    const problem = validateCareMessageAttachment(file);
    if (problem) {
      setError(problem);
      if (fileInputRef.current) fileInputRef.current.value = "";
      return;
    }
    setError(null);
    setPendingFile(file);
  };

  return (
    <div className="space-y-3">
      {isLoading && <p className="text-sm text-charcoal-ink/60 dark:text-night-ink/60">Loading…</p>}
      <ul className="space-y-3">
        {(messages ?? []).map((message) => (
          <li
            key={message.id}
            className={BUBBLE[message.author_role] ?? BUBBLE.patient}
          >
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className="text-xs font-medium text-charcoal-ink/70 dark:text-night-ink/70">
                {authorLabel(message)}
                {roleLabel(message) && (
                  <span className="ml-1 font-normal text-charcoal-ink/50 dark:text-night-ink/55">
                    · {roleLabel(message)}
                  </span>
                )}
              </span>
              <span className="text-xs text-charcoal-ink/50 dark:text-night-ink/55">{when(message.created_at)}</span>
            </div>
            <p className="mt-1 whitespace-pre-wrap text-sm text-charcoal-ink dark:text-night-ink">{message.body}</p>
            {message.attachments.length > 0 && (
              <div className="mt-2 flex flex-wrap gap-1.5">
                {message.attachments.map((a) => (
                  <AttachmentChip key={a.id} attachment={a} />
                ))}
              </div>
            )}
          </li>
        ))}
      </ul>

      {closed ? (
        <p className="text-sm text-charcoal-ink/50 dark:text-night-ink/55">This conversation is closed.</p>
      ) : (
        <div className="space-y-3">
          {showDraftAssist && <DraftReplyCard threadId={threadId} />}
          {isStaff && (
            <TemplatePicker onPick={(templateBody) => setBody(templateBody)} />
          )}
          {showEmergencyNotice && (
            <p className="rounded-lg bg-amber-50 dark:bg-amber-500/15 px-3 py-2 text-xs text-amber-900">
              Your care team reads messages here during working hours. This isn&apos;t a monitored
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
          {pendingFile && (
            <div className="flex items-center gap-2 text-xs text-charcoal-ink/60 dark:text-night-ink/60">
              <NAV_ICON.attachment className="h-3.5 w-3.5" strokeWidth={2} aria-hidden />
              {pendingFile.name}
              <button
                type="button"
                onClick={() => onFilePicked(null)}
                className="text-charcoal-ink/40 dark:text-night-ink/50 hover:text-charcoal-ink/70"
              >
                Remove
              </button>
            </div>
          )}
          <div className="flex items-center gap-3">
            <Button
              type="button"
              size="sm"
              disabled={post.isPending || body.trim().length === 0}
              onClick={send}
            >
              {post.isPending || upload.isPending ? "Sending…" : "Send"}
            </Button>
            {!isStaff && (
              <>
                <input
                  ref={fileInputRef}
                  type="file"
                  accept="image/jpeg,image/png,image/webp,image/heic,application/pdf"
                  className="hidden"
                  onChange={(e) => onFilePicked(e.target.files?.[0] ?? null)}
                />
                <button
                  type="button"
                  onClick={() => fileInputRef.current?.click()}
                  className="inline-flex items-center gap-1 text-xs font-medium text-charcoal-ink/60 dark:text-night-ink/60 hover:text-charcoal-ink dark:hover:text-night-ink"
                >
                  <NAV_ICON.attachment className="h-4 w-4" strokeWidth={2} aria-hidden />
                  Attach a file
                </button>
              </>
            )}
            {error && <span className="text-sm text-red-600 dark:text-red-300">{error}</span>}
          </div>
        </div>
      )}
    </div>
  );
}
