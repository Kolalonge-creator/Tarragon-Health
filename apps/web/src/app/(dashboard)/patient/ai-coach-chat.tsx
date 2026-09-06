"use client";

import { useState } from "react";
import Link from "next/link";
import { useQueryClient } from "@tanstack/react-query";
import { useAiConversation, useAiCoachQuickAction, useSendCoachMessage } from "@/lib/queries/ai-coach";
import { activeEmergencyKey } from "@/lib/queries/emergency";
import { requestCareTeamHandoffAction } from "@/lib/ai-coach/handoff-actions";
import { COACH_LIMIT_REACHED_REPLY } from "@/lib/ai-coach/rate-limit";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { SEMANTIC_ICON } from "@/lib/icons";
import type { CoachSuggestedAction } from "@tarragon/shared";
import { ReportAiAnswer } from "@/components/ai/report-ai-answer";
import { AI_SYSTEMS } from "@/lib/ai-governance/system-codes";

import { formatPatientDateTime } from "@/lib/format-date";
/**
 * §78.2 -- where each suggestedAction the model can classify actually
 * points. Deliberately a fixed, deterministic map: the model only ever
 * picks a kind (prompts.ts), never a URL or record id, so there's no way
 * for a model output to control navigation beyond choosing among these
 * four pre-approved destinations.
 */
const SUGGESTION_LINK: Record<Exclude<CoachSuggestedAction, "none">, { href: string; label: string }> = {
  medication_education: { href: "/patient/medications", label: "Look at your medications" },
  care_plan_explanation: { href: "/patient/care#care-plan", label: "See your care plan" },
  appointment_prep: { href: "/patient/appointments", label: "See your appointments" },
  service_navigation: { href: "/patient/care#find-a-service", label: "Find a service" },
};

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
  const [handoff, setHandoff] = useState<
    { status: "idle" } | { status: "pending" } | { status: "done" } | { status: "error"; error: string }
  >({ status: "idle" });

  async function handleHandoff() {
    setHandoff({ status: "pending" });
    const result = await requestCareTeamHandoffAction(conversation?.conversationId);
    setHandoff(result.success ? { status: "done" } : { status: "error", error: result.error });
  }

  const messages = conversation?.messages ?? [];
  const lastResult = sendMessage.data;
  const lastInteractionId =
    lastResult && lastResult.success ? lastResult.aiInteractionId : null;
  const lastMessage = messages[messages.length - 1];
  const limitReached =
    lastMessage?.role === "assistant" && lastMessage.content === COACH_LIMIT_REACHED_REPLY;

  function handleQuickAction(kind: (typeof QUICK_ACTIONS)[number]["kind"]) {
    if (quickAction.isPending || sendMessage.isPending) return;
    quickAction.mutate({ conversationId: conversation?.conversationId, kind });
  }

  function formatTimestamp(isoString: string): string {
    return formatPatientDateTime(isoString, {
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
    <Card id="ai-coach">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <SEMANTIC_ICON.aiCoach className="h-5 w-5 text-deep-forest dark:text-brand-green-bright" strokeWidth={2} aria-hidden />
          AI Health Coach
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="max-h-80 space-y-2 overflow-y-auto rounded-md bg-charcoal-ink/5 dark:bg-night-ink/10 p-3">
          {messages.length === 0 && !sendMessage.isPending && (
            <p className="text-sm text-charcoal-ink/60 dark:text-night-ink/60">
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
                  message.role === "user" ? "bg-brand-green text-white" : "bg-white dark:bg-night-card text-charcoal-ink dark:text-night-ink"
                )}
              >
                {message.content}
              </div>
              <p
                className={cn(
                  "text-[11px] text-charcoal-ink/40 dark:text-night-ink/50",
                  message.role === "user" ? "text-right" : "text-left"
                )}
              >
                {formatTimestamp(message.created_at)}
              </p>
              {message.suggestedAction && message.suggestedAction !== "none" && (
                <Link
                  href={SUGGESTION_LINK[message.suggestedAction].href}
                  className="inline-block text-xs text-brand-green dark:text-brand-green-bright underline"
                >
                  {SUGGESTION_LINK[message.suggestedAction].label} →
                </Link>
              )}
            </div>
          ))}
          {(sendMessage.isPending || quickAction.isPending) && (
            <div className="max-w-[85%] rounded-lg bg-white dark:bg-night-card px-3 py-2 text-sm text-charcoal-ink/60 dark:text-night-ink/60">
              Thinking…
            </div>
          )}
        </div>

        {sendMessage.data?.success === false && (
          <p className="text-sm text-red-600 dark:text-red-300">{sendMessage.data.error}</p>
        )}
        {quickAction.data?.success === false && (
          <p className="text-sm text-red-600 dark:text-red-300">{quickAction.data.error}</p>
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

        <div className="flex flex-col gap-2">
          <p className="text-xs text-charcoal-ink/50 dark:text-night-ink/55">
            General guidance, not a diagnosis. For an emergency, call emergency services or go to
            the nearest hospital.
          </p>
          {/* 40.12. Shown once there is something to report, and carrying the
              interaction id of the most recent turn when we have it, so the
              report lands against the exact answer rather than the thread. */}
          {(messages.length > 0 || lastInteractionId) && (
            <ReportAiAnswer
              systemCode={AI_SYSTEMS.coach.code}
              interactionId={lastInteractionId}
            />
          )}
        </div>

        {limitReached && (
          <div className="flex flex-wrap items-center gap-2 rounded-md border border-brand-green/30 bg-brand-green/5 p-3">
            <p className="text-xs text-charcoal-ink/70 dark:text-night-ink/70">
              Need more room today? A 30-day pass raises your daily message limit. Buy again any
              time, no auto-renewal.
            </p>
            <Button size="sm" variant="outline" asChild>
              <a href="/patient/subscription">Get the AI Coach Daily Pass</a>
            </Button>
          </div>
        )}

        {messages.length > 0 && (
          <div className="flex flex-wrap items-center gap-2 rounded-md border border-charcoal-ink/10 dark:border-night-ink/15 bg-charcoal-ink/[0.02] dark:bg-night-ink/10 p-3">
            <p className="text-xs text-charcoal-ink/70 dark:text-night-ink/70">Want a real doctor&apos;s take on this?</p>
            <Button size="sm" variant="outline" asChild>
              <a href="/patient/care#ask-a-doctor">Ask a doctor (written)</a>
            </Button>
            <Button size="sm" variant="outline" asChild>
              <a href="/patient/appointments">Book a video visit</a>
            </Button>
          </div>
        )}

        <div className="border-t border-charcoal-ink/10 dark:border-night-ink/15 pt-2">
          {handoff.status === "idle" && (
            <Button
              type="button"
              size="sm"
              variant="ghost"
              className="h-auto gap-1.5 px-0 text-xs text-brand-green dark:text-brand-green-bright hover:bg-transparent hover:underline"
              onClick={() => void handleHandoff()}
            >
              I want to speak to someone
            </Button>
          )}
          {handoff.status === "pending" && (
            <p className="text-xs text-charcoal-ink/60 dark:text-night-ink/60">Starting a conversation with your care team…</p>
          )}
          {handoff.status === "done" && (
            <p className="text-xs text-charcoal-ink dark:text-night-ink">
              Sent. Your care team has what you&apos;ve talked about here.{" "}
              <Link href="/patient/messages" className="text-brand-green dark:text-brand-green-bright underline">
                Continue in Messages
              </Link>
              .
            </p>
          )}
          {handoff.status === "error" && (
            <p className="text-xs text-red-600 dark:text-red-300">
              {handoff.error}. You can also message your care team directly from{" "}
              <Link href="/patient/messages" className="underline">
                Messages
              </Link>
              .
            </p>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
