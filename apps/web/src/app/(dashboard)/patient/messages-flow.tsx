"use client";

import { useState } from "react";
import { useCareThreads, useStartThread } from "@/lib/queries/care-messages";
import { CareMessageThread } from "@/components/care-message-thread";
import { Card, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { NAV_ICON } from "@/lib/icons";

/** Phone-only way back to the conversation list — on lg the list is still
 * sitting there beside this pane, so the control would be meaningless. */
function BackToList({ onClick }: { onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label="Back to messages"
      className="-ml-1 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-charcoal-ink/60 hover:bg-charcoal-ink/5 hover:text-charcoal-ink lg:hidden"
    >
      <NAV_ICON.chevronRight className="h-5 w-5 rotate-180" strokeWidth={2} aria-hidden />
    </button>
  );
}

function when(iso: string): string {
  return new Date(iso).toLocaleString("en-GB", {
    timeZone: "Africa/Lagos",
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function MessagesFlow({ patientId }: { patientId: string }) {
  const { data: threads, isLoading } = useCareThreads(patientId);
  const start = useStartThread();
  const [openId, setOpenId] = useState<string | null>(null);
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [composing, setComposing] = useState(false);

  const startThread = () => {
    setError(null);
    start.mutate(
      { subject, body, patientId },
      {
        onSuccess: (id) => {
          setSubject("");
          setBody("");
          setComposing(false);
          setOpenId(id);
        },
        onError: (err) => setError(err instanceof Error ? err.message : "Couldn't start"),
      },
    );
  };

  const openThread = (threads ?? []).find((t) => t.id === openId) ?? null;
  /* Phones get one pane at a time — the list, or the conversation you picked,
     with a way back. Two panes side by side needs about 600px; inside a
     375px-wide dashboard column the 288px list left the conversation itself
     roughly 50px wide and clipped off the edge of the card, so a patient on a
     phone could see that they had messages but never read one. Unchanged from
     lg up, where there is room for both. */
  const showDetail = composing || openThread !== null;

  return (
    <Card className="flex h-[560px] flex-col overflow-hidden p-0 lg:flex-row">
      <div
        className={`${
          showDetail ? "hidden lg:flex" : "flex"
        } w-full min-h-0 shrink-0 flex-col border-charcoal-ink/10 lg:w-72 lg:border-r`}
      >
        <div className="flex items-center justify-between border-b border-charcoal-ink/10 p-4">
          <CardTitle className="text-base">Messages</CardTitle>
          <Button
            type="button"
            size="sm"
            onClick={() => {
              setComposing(true);
              setOpenId(null);
            }}
          >
            New
          </Button>
        </div>
        <div className="flex-1 overflow-y-auto">
          {isLoading && <p className="p-4 text-sm text-charcoal-ink/60">Loading…</p>}
          {!isLoading && (!threads || threads.length === 0) && (
            <p className="p-4 text-sm text-charcoal-ink/60">
              No messages yet. Start a conversation with your care team.
            </p>
          )}
          <ul>
            {(threads ?? []).map((thread) => (
              <li key={thread.id}>
                <button
                  type="button"
                  onClick={() => {
                    setComposing(false);
                    setOpenId(thread.id);
                  }}
                  className={`w-full border-b border-charcoal-ink/6 px-4 py-3 text-left transition-colors ${
                    openId === thread.id ? "bg-warm-ivory" : "hover:bg-warm-ivory/60"
                  }`}
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="truncate text-sm font-semibold text-charcoal-ink">
                      {thread.subject}
                    </span>
                    {thread.status === "closed" && <Badge variant="grey">Closed</Badge>}
                  </div>
                  <p className="mt-0.5 text-xs text-charcoal-ink/50">{when(thread.last_message_at)}</p>
                </button>
              </li>
            ))}
          </ul>
        </div>
      </div>

      <div className={`${showDetail ? "flex" : "hidden lg:flex"} min-h-0 flex-1 flex-col`}>
        {composing ? (
          <div className="flex min-h-0 flex-1 flex-col">
            <div className="flex items-center gap-2 border-b border-charcoal-ink/10 p-4">
              <BackToList
                onClick={() => {
                  setComposing(false);
                  setError(null);
                }}
              />
              <span className="font-heading text-sm font-semibold text-charcoal-ink">
                New message to your care team
              </span>
            </div>
            <div className="flex-1 space-y-3 overflow-y-auto p-5">
              <div className="grid gap-2">
                <Label htmlFor="subject">Subject</Label>
                <Input
                  id="subject"
                  value={subject}
                  onChange={(e) => setSubject(e.target.value)}
                  placeholder="e.g. Question about my medication"
                  maxLength={150}
                />
              </div>
              <div className="grid gap-2">
                <Label htmlFor="body">Message</Label>
                <Textarea
                  id="body"
                  value={body}
                  onChange={(e) => setBody(e.target.value)}
                  rows={5}
                  maxLength={4000}
                />
              </div>
              <div className="flex items-center gap-3">
                <Button
                  type="button"
                  disabled={start.isPending || subject.trim().length < 3 || body.trim().length === 0}
                  onClick={startThread}
                >
                  {start.isPending ? "Sending…" : "Send"}
                </Button>
                {error && <span className="text-sm text-red-600">{error}</span>}
              </div>
            </div>
          </div>
        ) : openThread ? (
          <div className="flex min-h-0 flex-1 flex-col">
            <div className="flex items-center gap-2 border-b border-charcoal-ink/10 p-4">
              <BackToList onClick={() => setOpenId(null)} />
              <span className="min-w-0 truncate font-heading text-sm font-semibold text-charcoal-ink">
                {openThread.subject}
              </span>
              {openThread.status === "closed" && <Badge variant="grey">Closed</Badge>}
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto p-5">
              <CareMessageThread
                threadId={openThread.id}
                closed={openThread.status === "closed"}
                showEmergencyNotice
              />
            </div>
          </div>
        ) : (
          <div className="flex flex-1 items-center justify-center p-6 text-center text-sm text-charcoal-ink/50">
            Select a conversation, or start a new one with your care team.
          </div>
        )}
      </div>
    </Card>
  );
}
