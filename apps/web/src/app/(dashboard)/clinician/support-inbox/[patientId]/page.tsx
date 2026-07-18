"use client";

import { useState } from "react";
import { useParams } from "next/navigation";
import { useSupportMessages, useSendSupportReply } from "@/lib/queries/support-messages";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

function formatTime(createdAt: string): string {
  return new Date(createdAt).toLocaleString("en-GB", {
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export default function SupportThreadPage() {
  const { patientId } = useParams<{ patientId: string }>();
  const { data: messages, isLoading, isError } = useSupportMessages(patientId);
  const sendReply = useSendSupportReply();
  const [message, setMessage] = useState("");

  const patientName = messages?.find((m) => m.patient)?.patient?.full_name ?? "Patient";

  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-heading text-2xl font-semibold text-charcoal-ink">{patientName}</h1>
        <p className="text-charcoal-ink/60">Support conversation</p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Messages</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          {isLoading && <p className="text-sm text-charcoal-ink/60">Loading…</p>}
          {isError && <p className="text-sm text-red-600">Could not load this conversation.</p>}
          {messages?.map((m) => (
            <div
              key={m.id}
              className={cn(
                "max-w-[80%] rounded-lg px-3 py-2 text-sm",
                m.direction === "inbound"
                  ? "bg-charcoal-ink/5 text-charcoal-ink"
                  : "ml-auto bg-brand-green/10 text-charcoal-ink"
              )}
            >
              <p>{m.body}</p>
              <p className="mt-1 text-xs text-charcoal-ink/50">
                {m.direction === "outbound" && m.sender?.full_name && `${m.sender.full_name} · `}
                {formatTime(m.created_at)}
              </p>
            </div>
          ))}
          {messages?.length === 0 && (
            <p className="text-sm text-charcoal-ink/60">No messages yet.</p>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Reply</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <Textarea
            rows={3}
            placeholder="Your reply — signed automatically with your name"
            value={message}
            onChange={(e) => setMessage(e.target.value)}
          />
          {sendReply.isError && (
            <p className="text-sm text-red-600">{(sendReply.error as Error).message}</p>
          )}
          {sendReply.isSuccess && !sendReply.data.ok && (
            <p className="text-sm text-amber-600">
              Saved, but the WhatsApp send didn&apos;t go through ({sendReply.data.error}) — the
              patient may not have received this yet.
            </p>
          )}
          <Button
            disabled={!message.trim() || sendReply.isPending}
            onClick={() => {
              sendReply.mutate(
                { patientId, message: message.trim() },
                { onSuccess: () => setMessage("") }
              );
            }}
          >
            {sendReply.isPending ? "Sending…" : "Send reply"}
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}
