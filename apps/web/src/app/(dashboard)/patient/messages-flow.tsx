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
      { subject, body },
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

  return (
    <Card className="flex h-[560px] overflow-hidden p-0">
      <div className="flex w-72 shrink-0 flex-col border-r border-charcoal-ink/10">
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

      <div className="flex flex-1 flex-col">
        {composing ? (
          <div className="flex flex-1 flex-col">
            <div className="border-b border-charcoal-ink/10 p-4 font-heading text-sm font-semibold text-charcoal-ink">
              New message to your care team
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
          <div className="flex flex-1 flex-col">
            <div className="flex items-center gap-2 border-b border-charcoal-ink/10 p-4">
              <span className="font-heading text-sm font-semibold text-charcoal-ink">
                {openThread.subject}
              </span>
              {openThread.status === "closed" && <Badge variant="grey">Closed</Badge>}
            </div>
            <div className="flex-1 overflow-y-auto p-5">
              <CareMessageThread threadId={openThread.id} closed={openThread.status === "closed"} />
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
