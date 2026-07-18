"use client";

import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useAiConversation, useSendCoachMessage } from "@/lib/queries/ai-coach";
import { activeEmergencyKey } from "@/lib/queries/emergency";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { SEMANTIC_ICON } from "@/lib/icons";

export function AiCoachChat({ patientId }: { patientId: string }) {
  const { data: conversation } = useAiConversation(patientId);
  const sendMessage = useSendCoachMessage(patientId);
  const queryClient = useQueryClient();
  const [draft, setDraft] = useState("");

  const messages = conversation?.messages ?? [];

  function formatTimestamp(isoString: string): string {
    return new Date(isoString).toLocaleString([], {
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const message = draft.trim();
    if (!message || sendMessage.isPending) return;
    setDraft("");
    sendMessage.mutate(
      { conversationId: conversation?.conversationId, message },
      {
        // An emergency-tier message raises an emergency_events row server-side —
        // surface the EmergencyAlert dialog immediately rather than on next poll.
        onSettled: () =>
          queryClient.invalidateQueries({ queryKey: activeEmergencyKey(patientId) }),
      }
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <SEMANTIC_ICON.aiCoach className="h-5 w-5 text-deep-forest" strokeWidth={2} />
          AI Health Coach
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="max-h-80 space-y-2 overflow-y-auto rounded-md bg-charcoal-ink/5 p-3">
          {messages.length === 0 && !sendMessage.isPending && (
            <p className="text-sm text-charcoal-ink/60">
              Ask me anything about your health — I&apos;m here to help you understand what to do next.
            </p>
          )}
          {messages.map((message) => (
            <div
              key={message.id}
              className={cn("max-w-[85%] space-y-0.5", message.role === "user" ? "ml-auto" : "")}
            >
              <div
                className={cn(
                  "rounded-lg px-3 py-2 text-sm",
                  message.role === "user" ? "bg-brand-green text-white" : "bg-white text-charcoal-ink"
                )}
              >
                {message.content}
              </div>
              <p
                className={cn(
                  "text-[11px] text-charcoal-ink/40",
                  message.role === "user" ? "text-right" : "text-left"
                )}
              >
                {formatTimestamp(message.created_at)}
              </p>
            </div>
          ))}
          {sendMessage.isPending && (
            <div className="max-w-[85%] rounded-lg bg-white px-3 py-2 text-sm text-charcoal-ink/60">
              Thinking…
            </div>
          )}
        </div>

        {sendMessage.data?.success === false && (
          <p className="text-sm text-red-600">{sendMessage.data.error}</p>
        )}

        <form onSubmit={handleSubmit} className="flex gap-2">
          <Input
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            placeholder="Type a message…"
            disabled={sendMessage.isPending}
          />
          <Button type="submit" disabled={sendMessage.isPending || !draft.trim()}>
            Send
          </Button>
        </form>

        <p className="text-xs text-charcoal-ink/50">
          General guidance, not a diagnosis. For an emergency, call emergency services or go to
          the nearest hospital.
        </p>
      </CardContent>
    </Card>
  );
}
