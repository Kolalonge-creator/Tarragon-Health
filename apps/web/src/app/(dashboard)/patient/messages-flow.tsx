"use client";

import { useState } from "react";
import { useCareThreads, useStartThread } from "@/lib/queries/care-messages";
import { CareMessageThread } from "@/components/care-message-thread";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
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

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle>Message your care team</CardTitle>
          <Button type="button" size="sm" onClick={() => setComposing((v) => !v)}>
            {composing ? "Cancel" : "New message"}
          </Button>
        </CardHeader>
        <CardContent className="space-y-4">
          {composing && (
            <div className="space-y-3 rounded-lg border border-charcoal-ink/10 p-4">
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
                  rows={3}
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
          )}

          {isLoading && <p className="text-sm text-charcoal-ink/60">Loading…</p>}
          {!isLoading && (!threads || threads.length === 0) && !composing && (
            <p className="text-sm text-charcoal-ink/60">
              No messages yet. Start a conversation with your care team above.
            </p>
          )}

          <ul className="divide-y divide-charcoal-ink/10">
            {(threads ?? []).map((thread) => (
              <li key={thread.id} className="py-3">
                <button
                  type="button"
                  className="flex w-full items-center justify-between gap-2 text-left"
                  onClick={() => setOpenId(openId === thread.id ? null : thread.id)}
                >
                  <span className="font-medium text-charcoal-ink">{thread.subject}</span>
                  <span className="flex items-center gap-2">
                    {thread.status === "closed" && <Badge variant="grey">Closed</Badge>}
                    <span className="text-xs text-charcoal-ink/50">
                      {when(thread.last_message_at)}
                    </span>
                  </span>
                </button>
                {openId === thread.id && (
                  <div className="mt-3">
                    <CareMessageThread threadId={thread.id} closed={thread.status === "closed"} />
                  </div>
                )}
              </li>
            ))}
          </ul>
        </CardContent>
      </Card>
    </div>
  );
}
