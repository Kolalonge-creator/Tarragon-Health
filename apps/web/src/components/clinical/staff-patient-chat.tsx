"use client";

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { createClient } from "@/lib/supabase/client";
import { MaskedCallButton } from "@/components/masked-call-button";
import { useCareThreads, useStartThread } from "@/lib/queries/care-messages";
import { CareMessageThread } from "@/components/care-message-thread";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";

/**
 * A staff member's in-app chat with one patient: the patient's open
 * conversation if there is one, otherwise a short form to start one.
 *
 * Shared by the Care Coordinator screens and the doctor patient page, so a
 * member of the care team can ask the patient a question in the app when an
 * email or call has gone unanswered. Any org staff account may open a thread
 * (start_care_thread) and reply to it (post_care_message), so nothing here
 * needs clinical authority. Replies from the patient land in Patient messages.
 */
export function StaffPatientChat({
  patientId,
  patientName,
  defaultSubject = "A message from your care team",
  startClosed = false,
}: {
  patientId: string;
  patientName: string;
  defaultSubject?: string;
  /** Show only an "Open chat" button until clicked. Opening a thread is an audited read and
   * marks it read, so a page that merely hosts the chat must not open it on load. */
  startClosed?: boolean;
}) {
  const [revealed, setRevealed] = useState(!startClosed);
  if (!revealed) {
    return (
      <Button size="sm" variant="outline" onClick={() => setRevealed(true)}>
        Open chat with {patientName}
      </Button>
    );
  }
  return <StaffPatientChatBody patientId={patientId} patientName={patientName} defaultSubject={defaultSubject} />;
}

function StaffPatientChatBody({
  patientId,
  patientName,
  defaultSubject,
}: {
  patientId: string;
  patientName: string;
  defaultSubject: string;
}) {
  const { data: threads, isLoading, isError } = useCareThreads(patientId);
  const start = useStartThread();
  const { data: staffId } = useQuery({
    queryKey: ["current-user-id"],
    queryFn: async () => (await createClient().auth.getUser()).data.user?.id ?? null,
    staleTime: Infinity,
  });
  const [composing, setComposing] = useState(false);
  const [subject, setSubject] = useState(defaultSubject);
  const [body, setBody] = useState("");

  // Confidential threads (e.g. sexual health) are unreadable to staff by design, so they are never listed.
  const openThreads = (threads ?? []).filter((t) => t.status === "open" && !t.confidential);
  const [latest, ...earlier] = openThreads;
  const [shown, setShown] = useState<string[]>([]);
  const showForm = composing || (!isLoading && !isError && openThreads.length === 0);

  return (
    <div className="space-y-3">
      {staffId && (
        // One tap to move a stuck conversation to a call (the number stays masked).
        <MaskedCallButton
          patientId={patientId}
          staffProfileId={staffId}
          otherPartyLabel={patientName}
          context="care_coordination"
        />
      )}
      {isLoading && <p className="text-sm text-charcoal-ink/60">Loading messages…</p>}
      {isError && <p className="text-sm text-red-600">Could not load this patient&apos;s messages.</p>}

      {/* Only the newest open thread is loaded; each earlier one loads when asked for. */}
      {latest && <ThreadCard thread={latest} patientId={patientId} />}
      {earlier.map((thread) =>
        shown.includes(thread.id) ? (
          <ThreadCard key={thread.id} thread={thread} patientId={patientId} />
        ) : (
          <Button key={thread.id} size="sm" variant="ghost" onClick={() => setShown((ids) => [...ids, thread.id])}>
            Earlier conversation: {thread.subject}
          </Button>
        )
      )}

      {showForm ? (
        <div className="space-y-2 rounded-md border border-charcoal-ink/10 bg-warm-ivory/60 p-3">
          <p className="text-xs font-medium text-charcoal-ink/70">
            New in-app message to {patientName}. They will see it in the app and get a notification.
          </p>
          <Input
            value={subject}
            onChange={(event) => setSubject(event.target.value)}
            placeholder="Subject"
            className="h-8 text-xs"
            aria-label="Subject"
          />
          <Textarea
            value={body}
            onChange={(event) => setBody(event.target.value)}
            placeholder="Message"
            rows={3}
            className="text-xs"
            aria-label="Message"
          />
          <div className="flex items-center gap-2">
            <Button
              size="sm"
              disabled={start.isPending || subject.trim().length < 3 || body.trim().length === 0}
              onClick={() =>
                start.mutate(
                  { patientId, subject: subject.trim(), body: body.trim() },
                  {
                    onSuccess: () => {
                      setBody("");
                      setComposing(false);
                    },
                  }
                )
              }
            >
              {start.isPending ? "Sending…" : "Send"}
            </Button>
            {composing && (
              <Button size="sm" variant="ghost" onClick={() => setComposing(false)}>
                Cancel
              </Button>
            )}
            {start.isError && (
              <span role="alert" className="text-xs text-red-600">
                {(start.error as Error).message || "Could not send."}
              </span>
            )}
          </div>
        </div>
      ) : (
        <Button size="sm" variant="outline" onClick={() => setComposing(true)}>
          Start a new conversation
        </Button>
      )}
    </div>
  );
}

function ThreadCard({ thread, patientId }: { thread: { id: string; subject: string }; patientId: string }) {
  return (
    <div className="space-y-2 rounded-md border border-charcoal-ink/10 p-3">
      <p className="text-sm font-medium text-charcoal-ink">{thread.subject}</p>
      <CareMessageThread threadId={thread.id} patientId={patientId} closed={false} isStaff />
    </div>
  );
}
