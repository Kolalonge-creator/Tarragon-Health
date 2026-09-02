"use client";

import { useState, useTransition } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  stepSymptomTriage,
  type PresentingComplaintOption,
  type SymptomTriageStepResult,
} from "./symptom-triage-actions";
import { activeEmergencyKey } from "@/lib/queries/emergency";
import { CATEGORY_SAFETY_NET_MESSAGE, getSafetyNetMessage } from "@/lib/symptom-triage/safety-net-copy";
import type { AnswerMap, AnsweredQuestion, Onset, QuestionNode } from "@tarragon/symptom-triage-engine";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Badge, type BadgeProps } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

type Stage =
  | { step: "pick_complaint" }
  | { step: "capture"; complaintKey: string }
  | { step: "question"; question: QuestionNode; capture: CaptureDraft; answers: AnswerMap; questionLog: AnsweredQuestion[] }
  | {
      step: "result";
      category: string;
      clinicianReviewRequired: boolean;
      safetyNetMessageKey: string;
    }
  | { step: "unavailable" }
  | { step: "error"; message: string };

type CaptureDraft = {
  presentingComplaintKey: string;
  onset: Onset;
  severity: number;
  associatedSymptoms: string[];
  triggers: string[];
  relevantHistory: string[];
  measurements: Record<string, number>;
};

const CATEGORY_BADGE_VARIANT: Record<string, BadgeProps["variant"]> = {
  emergency: "red",
  urgent: "amber",
  routine: "blue",
  self_management: "green",
};

const CATEGORY_LABEL: Record<string, string> = {
  emergency: "Seek emergency care",
  urgent: "See a clinician soon",
  routine: "Routine appointment",
  self_management: "Self-care for now",
};

function handleStepResult(result: SymptomTriageStepResult): Stage {
  if (result.status === "unavailable") return { step: "unavailable" };
  if (result.status === "error") return { step: "error", message: result.error };
  if (result.status === "in_progress") {
    return {
      step: "question",
      question: result.question,
      capture: result.state.capture as CaptureDraft,
      answers: result.state.answers,
      questionLog: result.state.questionLog,
    };
  }
  return {
    step: "result",
    category: result.category,
    clinicianReviewRequired: result.clinicianReviewRequired,
    safetyNetMessageKey: result.safetyNetMessageKey,
  };
}

/**
 * Symptom Assessment & Triage Engine (platform brief §37) — the patient's
 * entry point. Answers "what is the safest appropriate next step?" — a
 * routing decision, never "what diagnosis does this person have?" (§37.1,
 * §37.12). Every step calls the server directly (not a <form action>) so
 * the wizard can walk an arbitrary-length dynamic question tree without a
 * page reload between questions; the server recomputes everything from the
 * signed protocol config on every call, so nothing here is trusted for the
 * actual classification.
 */
export function SymptomTriageCheck({
  patientId,
  presentingComplaints,
}: {
  patientId: string;
  presentingComplaints: PresentingComplaintOption[];
}) {
  const [stage, setStage] = useState<Stage>({ step: "pick_complaint" });
  const [pending, startTransition] = useTransition();
  const queryClient = useQueryClient();

  if (presentingComplaints.length === 0) {
    // No signed protocol yet (see triage_protocols migration) — the
    // feature stays hidden rather than showing a broken/empty picker.
    return null;
  }

  function pickComplaint(complaintKey: string) {
    setStage({ step: "capture", complaintKey });
  }

  function submitCapture(capture: CaptureDraft) {
    startTransition(async () => {
      const result = await stepSymptomTriage({ capture, answers: {}, questionLog: [] });
      setStage(handleStepResult(result));
    });
  }

  function submitAnswer(current: Extract<Stage, { step: "question" }>, value: boolean | string) {
    const answers = { ...current.answers, [current.question.key]: value };
    startTransition(async () => {
      const result = await stepSymptomTriage({ capture: current.capture, answers, questionLog: current.questionLog });
      const next = handleStepResult(result);
      setStage(next);
      if (next.step === "result" && (next.category === "emergency" || next.category === "urgent")) {
        // An emergency assessment raises a linked emergency_events row
        // server-side — surface the EmergencyAlert dialog immediately
        // rather than waiting on its next poll (mirrors SymptomLogForm).
        queryClient.invalidateQueries({ queryKey: activeEmergencyKey(patientId) });
      }
    });
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Check a symptom</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {stage.step === "pick_complaint" && (
          <div className="space-y-2">
            <p className="text-sm text-charcoal-ink/70">
              Tell us what&apos;s going on and we&apos;ll help you work out the safest next step.
            </p>
            <div className="flex flex-wrap gap-2">
              {presentingComplaints.map((c) => (
                <Button key={c.key} type="button" variant="outline" onClick={() => pickComplaint(c.key)}>
                  {c.label}
                </Button>
              ))}
            </div>
          </div>
        )}

        {stage.step === "capture" && (
          <InitialCaptureForm complaintKey={stage.complaintKey} pending={pending} onSubmit={submitCapture} />
        )}

        {stage.step === "question" && (
          <QuestionStep question={stage.question} pending={pending} onAnswer={(v) => submitAnswer(stage, v)} />
        )}

        {stage.step === "result" && (
          <div className="space-y-3">
            <Badge variant={CATEGORY_BADGE_VARIANT[stage.category]}>
              {CATEGORY_LABEL[stage.category] ?? stage.category}
            </Badge>
            <p className="text-sm text-charcoal-ink">
              {getSafetyNetMessage(
                stage.safetyNetMessageKey,
                stage.category as keyof typeof CATEGORY_SAFETY_NET_MESSAGE
              )}
            </p>
            {stage.clinicianReviewRequired && (
              <p className="text-sm text-charcoal-ink/70">
                A member of our care team will also take a look at this one directly.
              </p>
            )}
            <Button type="button" variant="outline" onClick={() => setStage({ step: "pick_complaint" })}>
              Check another symptom
            </Button>
          </div>
        )}

        {stage.step === "unavailable" && (
          <p className="text-sm text-charcoal-ink/70">
            The symptom checker isn&apos;t available right now. If something&apos;s worrying you, please use the emergency
            check above or reach out to your care team.
          </p>
        )}

        {stage.step === "error" && <p className="text-sm text-red-700">{stage.message}</p>}
      </CardContent>
    </Card>
  );
}

function InitialCaptureForm({
  complaintKey,
  pending,
  onSubmit,
}: {
  complaintKey: string;
  pending: boolean;
  onSubmit: (capture: CaptureDraft) => void;
}) {
  const [onset, setOnset] = useState<Onset>("gradual");
  const [severity, setSeverity] = useState(5);

  return (
    <form
      className="space-y-4"
      onSubmit={(e) => {
        e.preventDefault();
        onSubmit({
          presentingComplaintKey: complaintKey,
          onset,
          severity,
          associatedSymptoms: [],
          triggers: [],
          relevantHistory: [],
          measurements: {},
        });
      }}
    >
      <div className="space-y-1.5">
        <Label>When did it start?</Label>
        <div className="flex gap-4 text-sm">
          {(["sudden", "gradual", "unknown"] as const).map((v) => (
            <label key={v} className="flex items-center gap-1.5">
              <input type="radio" name="onset" checked={onset === v} onChange={() => setOnset(v)} />
              {v === "sudden" ? "Suddenly" : v === "gradual" ? "Gradually" : "Not sure"}
            </label>
          ))}
        </div>
      </div>

      <div className="space-y-1.5">
        <div className="flex items-center justify-between">
          <Label htmlFor="severity">Severity</Label>
          <span className="text-sm font-semibold text-charcoal-ink">{severity}/10</span>
        </div>
        <input
          id="severity"
          type="range"
          min={1}
          max={10}
          value={severity}
          onChange={(e) => setSeverity(Number(e.target.value))}
          className="w-full"
        />
      </div>

      <Button type="submit" disabled={pending}>
        {pending ? "Checking..." : "Continue"}
      </Button>
    </form>
  );
}

function QuestionStep({
  question,
  pending,
  onAnswer,
}: {
  question: QuestionNode;
  pending: boolean;
  onAnswer: (value: boolean | string) => void;
}) {
  return (
    <div className="space-y-3">
      <p className="text-sm font-medium text-charcoal-ink">{question.prompt}</p>
      {question.kind === "boolean" ? (
        <div className="flex gap-2">
          <Button type="button" disabled={pending} onClick={() => onAnswer(true)}>
            Yes
          </Button>
          <Button type="button" variant="outline" disabled={pending} onClick={() => onAnswer(false)}>
            No
          </Button>
        </div>
      ) : (
        <div className="flex flex-col gap-2">
          {question.options.map((opt) => (
            <Button
              key={opt.value}
              type="button"
              variant="outline"
              disabled={pending}
              onClick={() => onAnswer(opt.value)}
              className="justify-start"
            >
              {opt.label}
            </Button>
          ))}
        </div>
      )}
    </div>
  );
}
