"use client";

import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useAiConversation, useAiCoachQuickAction, useSendCoachMessage } from "@/lib/queries/ai-coach";
import { activeEmergencyKey } from "@/lib/queries/emergency";
import { COACH_LIMIT_REACHED_REPLY } from "@/lib/ai-coach/rate-limit";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { SEMANTIC_ICON } from "@/lib/icons";

const QUICK_ACTIONS = [
  { kind: "explain_record" as const, label: "Explain my health record" },
  { kind: "care_plan_summary" as const, label: "What do I need this month?" },
  { kind: "appointment_prep" as const, label: "Help me prepare for my appointment" },
];

export function AiCoachChat({ patientId }: { patientId: string }) {
  const { data: conversation } = useAiConversation(patientId);
  const sendMessage = useSendCoachMessage(patientId);
  const quickAction = useAiCoachQuickAction(patientId);
  const queryClient = useQueryClient();
  const [draft, setDraft] = useState("");

  const messages = conversation?.messages ?? [];
  const lastMessage = messages[messages.length - 1];
  const limitReached =
    lastMessage?.role === "assistant" && lastMessage.content === COACH_LIMIT_REACHED_REPLY;

  function handleQuickAction(kind: (typeof QUICK_ACTIONS)[number]["kind"]) {
    if (quickAction.isPending || sendMessage.isPending) return;
    quickAction.mutate({ conversationId: conversation?.conversationId, kind });
  }

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
              Ask me anything about your health; I&apos;m here to help you understand what to do next.
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
          {(sendMessage.isPending || quickAction.isPending) && (
            <div className="max-w-[85%] rounded-lg bg-white px-3 py-2 text-sm text-charcoal-ink/60">
              Thinking…
            </div>
          )}
        </div>

        {sendMessage.data?.success === false && (
          <p className="text-sm text-red-600">{sendMessage.data.error}</p>
        )}
        {quickAction.data?.success === false && (
          <p className="text-sm text-red-600">{quickAction.data.error}</p>
        )}

        <div className="flex flex-wrap gap-2">
          {QUICK_ACTIONS.map((action) => (
            <Button
              key={action.kind}
              type="button"
              variant="outline"
              size="sm"
              disabled={quickAction.isPending || sendMessage.isPending}
              onClick={() => handleQuickAction(action.kind)}
            >
              {action.label}
            </Button>
          ))}
        </div>

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

        {limitReached && (
          <div className="flex flex-wrap items-center gap-2 rounded-md border border-brand-green/30 bg-brand-green/5 p-3">
            <p className="text-xs text-charcoal-ink/70">
              Need more room today? A 30-day pass raises your daily message limit — buy again any
              time, no auto-renewal.
            </p>
            <Button size="sm" variant="outline" asChild>
              <a href="/patient/subscription">Get the AI Coach Daily Pass</a>
            </Button>
          </div>
        )}

        {messages.length > 0 && (
          <div className="flex flex-wrap items-center gap-2 rounded-md border border-charcoal-ink/10 bg-charcoal-ink/[0.02] p-3">
            <p className="text-xs text-charcoal-ink/70">Want a real doctor&apos;s take on this?</p>
            <Button size="sm" variant="outline" asChild>
              <a href="/patient/care#ask-a-doctor">Ask a doctor (written)</a>
            </Button>
            <Button size="sm" variant="outline" asChild>
              <a href="/patient/appointments">Book a video visit</a>
            </Button>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
