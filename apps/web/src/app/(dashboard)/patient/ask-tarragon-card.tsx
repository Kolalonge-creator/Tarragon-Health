"use client";

import { useState } from "react";
import Link from "next/link";
import { useQueryClient } from "@tanstack/react-query";
import { useAiConversation, useSendCoachMessage } from "@/lib/queries/ai-coach";
import { activeEmergencyKey } from "@/lib/queries/emergency";
import { requestCareTeamHandoffAction } from "@/lib/ai-coach/handoff-actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { PatientResultUpload } from "@/components/patient-result-upload";
import { SEMANTIC_ICON } from "@/lib/icons";
import { ReportAiAnswer } from "@/components/ai/report-ai-answer";
import { AI_SYSTEMS } from "@/lib/ai-governance/system-codes";

/**
 * The prominent, single-screen "front door" version of what already exists
 * split across two dashboard sections -- the AI Health Coach (AI-001,
 * apps/web/src/app/(dashboard)/patient/ai-coach-chat.tsx, buried in Care &
 * support) and the result-upload + AI summary + "discuss with a doctor" flow
 * (AI-005; the PatientResultUpload component embedded below is the same one
 * result-documents.tsx already composes with AiResultSummary in Labs &
 * bookings). No new AI system, no new migration -- this is deliberately a
 * thin composition over both already-governed pipelines, placed where a
 * patient actually lands (Overview), because the gap found was
 * discoverability, not missing capability. See the AI Health Assistant
 * architecture doc's own Level-1-reuse-first recommendation.
 *
 * The symptom half reuses the exact same conversation the full AI Coach chat
 * reads (useAiConversation keys on the patient's single latest
 * ai_conversations row) -- a question asked here shows up in "Continue in
 * AI Health Coach" and vice versa, not a second, parallel thread.
 *
 * coachAccess mirrors the gate care/page.tsx applies before ever mounting
 * AiCoachChat ({coachAccess && <AiCoachChat .../>}) -- runCoachTurn's own
 * entitlement check degrades to a canned COACH_ACCESS_DENIED_REPLY rather
 * than throwing, which this component has no way to tell apart from a real
 * answer, so the symptom half must not be offered at all to a patient the
 * entitlement was designed to turn away. The upload half carries no such
 * gate -- self-arranged upload is free on every plan (see
 * PatientResultUpload's own header comment).
 */
export function AskTarragonCard({
  patientId,
  coachAccess,
}: {
  patientId: string;
  coachAccess: boolean;
}) {
  const { data: conversation } = useAiConversation(patientId);
  const sendMessage = useSendCoachMessage(patientId);
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

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const message = draft.trim();
    if (!message || sendMessage.isPending) return;
    setDraft("");
    sendMessage.mutate(
      { conversationId: conversation?.conversationId, message },
      {
        // Same reasoning as ai-coach-chat.tsx: an emergency-tier reply raises
        // an emergency_events row server-side, so surface the EmergencyAlert
        // dialog immediately rather than waiting on the next poll.
        onSettled: () =>
          queryClient.invalidateQueries({ queryKey: activeEmergencyKey(patientId) }),
      }
    );
  }

  const lastResult = sendMessage.data;
  const lastReply = lastResult?.success ? lastResult.reply : null;
  const lastInteractionId = lastResult?.success ? lastResult.aiInteractionId : null;

  return (
    <Card id="ask-tarragon">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <SEMANTIC_ICON.aiCoach className="h-5 w-5 text-deep-forest dark:text-brand-green-bright" strokeWidth={2} aria-hidden />
          Ask about a result or a symptom
        </CardTitle>
        <CardDescription>
          {coachAccess
            ? "Describe what's worrying you or share a lab result, and get plain-language guidance plus a fast way to reach a Tarragon doctor."
            : "Share a lab result and get plain-language guidance plus a fast way to reach a Tarragon doctor."}
        </CardDescription>
      </CardHeader>
      <CardContent>
        <div className={coachAccess ? "grid grid-cols-1 gap-4 lg:grid-cols-2" : "grid grid-cols-1 gap-4"}>
          {coachAccess && (
            <div className="space-y-3 rounded-lg border border-charcoal-ink/10 dark:border-night-ink/15 p-3">
              <p className="text-sm font-medium text-charcoal-ink dark:text-night-ink">
                Got a symptom you&apos;re worried about?
              </p>
              <form onSubmit={handleSubmit} className="flex gap-2">
                <Input
                  value={draft}
                  onChange={(e) => setDraft(e.target.value)}
                  placeholder="e.g. I've had a headache for two days…"
                  disabled={sendMessage.isPending}
                />
                <Button type="submit" disabled={sendMessage.isPending || !draft.trim()}>
                  {sendMessage.isPending ? "Asking…" : "Ask"}
                </Button>
              </form>

              {sendMessage.data?.success === false && (
                <p className="text-sm text-red-600 dark:text-red-300">{sendMessage.data.error}</p>
              )}

              {lastReply && (
                <div className="space-y-2 rounded-md bg-charcoal-ink/5 dark:bg-night-ink/10 p-3">
                  <p className="text-sm text-charcoal-ink dark:text-night-ink">{lastReply}</p>
                  <div className="flex flex-wrap gap-2">
                    <Button size="sm" variant="outline" asChild>
                      <a href="/patient/care#ask-a-doctor">Ask a doctor (written)</a>
                    </Button>
                    <Button size="sm" variant="outline" asChild>
                      <a href="/patient/appointments">Book a video visit</a>
                    </Button>
                    {handoff.status === "idle" && (
                      <Button size="sm" variant="ghost" onClick={() => void handleHandoff()}>
                        I want to speak to someone
                      </Button>
                    )}
                  </div>
                  {handoff.status === "pending" && (
                    <p className="text-xs text-charcoal-ink/60 dark:text-night-ink/60">
                      Starting a conversation with your care team…
                    </p>
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
                  <ReportAiAnswer systemCode={AI_SYSTEMS.coach.code} interactionId={lastInteractionId} />
                </div>
              )}

              <p className="text-xs text-charcoal-ink/50 dark:text-night-ink/55">
                General guidance, not a diagnosis. For an emergency, call emergency services or go to
                the nearest hospital.{" "}
                <Link href="/patient/care#ai-coach" className="underline">
                  Continue in AI Health Coach →
                </Link>
              </p>
            </div>
          )}

          <div className="space-y-3 rounded-lg border border-charcoal-ink/10 dark:border-night-ink/15 p-3">
            <p className="text-sm font-medium text-charcoal-ink dark:text-night-ink">
              Got a lab result to share?
            </p>
            <PatientResultUpload label="Upload a result" patientId={patientId} />
            <p className="text-xs text-charcoal-ink/50 dark:text-night-ink/55">
              We&apos;ll read it and let you know right away if anything looks outside range, with
              an option to discuss it with a doctor.{" "}
              <Link href="/patient/labs" className="underline">
                See your results →
              </Link>
            </p>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
