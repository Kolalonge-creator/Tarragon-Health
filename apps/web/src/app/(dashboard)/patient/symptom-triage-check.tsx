"use client";

import { useState, useTransition } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  requestSymptomReview,
  stepSymptomTriage,
  type PresentingComplaintOption,
  type ReviewTime,
  type SymptomTriageStepResult,
} from "./symptom-triage-actions";
import { activeEmergencyKey } from "@/lib/queries/emergency";
import { CATEGORY_SAFETY_NET_MESSAGE, getSafetyNetMessage } from "@/lib/symptom-triage/safety-net-copy";
import {
  SEED_PATHWAYS,
  categoryAtLeast,
  evaluateBundledRedFlags,
  nextTriageStep,
  runTriageFailSafe,
  type AnswerMap,
  type AnsweredQuestion,
  type DegradedModeConfig,
  type Onset,
  type QuestionNode,
  type SymptomCapture,
  type TriageCategory,
  type UrgencyLevel,
} from "@tarragon/symptom-triage-engine";
import { t, type MessageKey } from "@tarragon/i18n";
import { NotADiagnosis } from "@/components/symptom/not-a-diagnosis";
import { SymptomNextSteps, resultHeadline } from "./symptom-next-steps";
import { SkinPhotoCard } from "./skin-photo-card";
import { reviewTimeSentence } from "@/lib/symptom-triage/review-time";
import { symptomOptionLabel } from "@/lib/symptom-triage/option-label";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Badge, type BadgeProps } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { FormError, fieldErrorId } from "@/components/ui/form-error";

type Stage =
  | { step: "pick_complaint" }
  | { step: "capture"; complaintKey: string }
  | { step: "question"; question: QuestionNode; capture: CaptureDraft; answers: AnswerMap; questionLog: AnsweredQuestion[] }
  | {
      step: "result";
      category: string;
      clinicianReviewRequired: boolean;
      safetyNetMessageKey: string;
      assessmentId: string | null;
      /** The engine could not answer; this is the fail-toward-escalation result. */
      degraded: boolean;
      /** The check could not be saved (the patient still has this result). */
      recorded: boolean;
      /** Worked out on this device, with no server (INV-06). */
      onDevice: boolean;
      /** The six-level wording, only from a signed urgency map; null shows the four-category result alone. */
      urgencyLevel: string | null;
      forDependant: boolean;
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
    assessmentId: result.assessmentId,
    degraded: result.degraded,
    recorded: result.recorded,
    onDevice: false,
    urgencyLevel: result.urgencyLevel,
    forDependant: result.forDependant,
  };
}

type ResultStage = Extract<Stage, { step: "result" }>;

/**
 * INV-06: the red-flag screen runs on this device, from content bundled with the page, so emergency guidance never waits for a
 * network. This builds the result stage for the bundled floor (or the engine-down fallback) with no server call.
 */
async function resultOnDevice(capture: SymptomCapture, degraded: DegradedModeConfig): Promise<ResultStage> {
  const r = await runTriageFailSafe({ pathway: null, capture, answers: {}, degraded });
  return {
    step: "result",
    category: r.category,
    clinicianReviewRequired: true,
    safetyNetMessageKey: r.safetyNetMessageKey,
    assessmentId: null,
    degraded: true,
    recorded: false,
    onDevice: true,
    urgencyLevel: null,
    forDependant: false,
  };
}

/** Never let a later, softer answer (or a "closed" or an error) replace an emergency the bundled floor already showed. */
function keepMoreUrgent(shown: ResultStage | null, next: Stage): Stage {
  if (!shown) return next;
  if (next.step !== "result") return shown;
  return categoryAtLeast(next.category as TriageCategory, shown.category as TriageCategory)
    ? next
    : { ...next, category: shown.category, safetyNetMessageKey: shown.safetyNetMessageKey };
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
  degradedConfig,
  reviewTime,
}: {
  patientId: string;
  presentingComplaints: PresentingComplaintOption[];
  /** PROPOSED config `symptom.degraded_mode`, read on the server. */
  degradedConfig: DegradedModeConfig;
  /** The stated review time from the active signed SLA, or not stated. */
  reviewTime: ReviewTime;
}) {
  const [stage, setStage] = useState<Stage>({ step: "pick_complaint" });
  const [pending, startTransition] = useTransition();
  const queryClient = useQueryClient();
  const [complaintKey, setComplaintKey] = useState<string>("");

  if (presentingComplaints.length === 0) {
    // Closed: the go-live guard `symptom_checker_enabled` is off, or no protocol is signed yet. Never a
    // broken or empty picker; a calm note that points to the safe routes that are always open (F1, INV-14).
    return (
      <Card>
        <CardHeader>
          <CardTitle>Check a symptom</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-charcoal-ink/70 dark:text-night-ink/70">
            The symptom checker is not open yet. If something is worrying you, use the emergency check above or
            message your care team. If you think it is an emergency, go to the nearest hospital now.
          </p>
        </CardContent>
      </Card>
    );
  }

  /**
   * Slow connections (spec 12.1): when the signed pathway is exactly the one bundled with the app (the server says so), the question
   * walk runs on this device and the server is called ONCE, with every answer, at the end. The server still recomputes everything.
   */
  function bundledPathway(key: string) {
    return presentingComplaints.find((c) => c.key === key)?.bundledCurrent ? SEED_PATHWAYS.find((p) => p.key === key) : undefined;
  }

  function pickComplaint(key: string) {
    setComplaintKey(key);
    setStage({ step: "capture", complaintKey: key });
  }

  function submitCapture(capture: CaptureDraft) {
    // Red flags first, on this device (spec 12.8, INV-06). An emergency is shown at once, before and whatever the server does.
    const local = evaluateBundledRedFlags(capture as SymptomCapture);
    let shown: ResultStage | null = null;
    if (local.topCategory === "emergency") {
      const first = local.fired[0];
      shown = {
        step: "result",
        category: "emergency",
        clinicianReviewRequired: true,
        safetyNetMessageKey: first ? `redflag.${first.key}` : "degraded.engine_unavailable",
        assessmentId: null,
        degraded: false,
        recorded: false,
        onDevice: true,
        urgencyLevel: null,
        forDependant: false,
      };
      setStage(shown);
    }
    const bundled = bundledPathway(capture.presentingComplaintKey);
    if (bundled && shown === null) {
      const step = nextTriageStep(bundled, {}, []);
      if (!step.done) {
        setStage({ step: "question", question: step.question, capture, answers: {}, questionLog: [] });
        return;
      }
    }
    startTransition(async () => {
      try {
        const result = await stepSymptomTriage({ capture, answers: {}, questionLog: [] });
        // closed or unavailable never replaces an on-device emergency
        const next = handleStepResult(result);
        const final = keepMoreUrgent(shown, next);
        setStage(final);
        // the emergency dialog should appear at once, not on its next poll (a capture can now complete as emergency or urgent)
        if (final.step === "result" && (final.category === "emergency" || final.category === "urgent")) {
          queryClient.invalidateQueries({ queryKey: activeEmergencyKey(patientId) });
        }
      } catch {
        // no server: the answer is worked out here, and it can only be as safe or safer than silence
        const fallback = await resultOnDevice(capture as SymptomCapture, degradedConfig);
        setStage(keepMoreUrgent(shown, fallback));
      }
    });
  }

  function submitAnswer(current: Extract<Stage, { step: "question" }>, value: boolean | string) {
    const answers = { ...current.answers, [current.question.key]: value };
    const bundled = bundledPathway(current.capture.presentingComplaintKey);
    if (bundled) {
      const step = nextTriageStep(bundled, answers, current.questionLog);
      if (!step.done) {
        setStage({ ...current, question: step.question, answers });
        return;
      }
    }
    startTransition(async () => {
      let next: Stage;
      try {
        const result = await stepSymptomTriage({ capture: current.capture, answers, questionLog: current.questionLog });
        next = handleStepResult(result);
      } catch {
        next = await resultOnDevice(current.capture as SymptomCapture, degradedConfig);
      }
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
            <p className="text-sm text-charcoal-ink/70 dark:text-night-ink/70">
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
              {resultHeadline(
                stage.category as TriageCategory,
                stage.urgencyLevel as UrgencyLevel | null,
                CATEGORY_LABEL[stage.category] ?? stage.category.replace(/_/g, " "),
              )}
            </Badge>
            {stage.degraded && (
              <div className="space-y-1 rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-900" role="status">
                <p className="font-medium">{t("symptom.degraded.title")}</p>
                <p>{t(stage.onDevice ? "symptom.degraded.offline" : "symptom.degraded.body")}</p>
              </div>
            )}
            <p className="text-sm text-charcoal-ink dark:text-night-ink">
              {stage.category === "emergency"
                ? t("symptom.emergency.go_now")
                : getSafetyNetMessage(stage.safetyNetMessageKey, stage.category as keyof typeof CATEGORY_SAFETY_NET_MESSAGE)}
            </p>
            {stage.category === "urgent" && stage.degraded && (
              <p className="text-sm text-charcoal-ink dark:text-night-ink">{t("symptom.result.urgent_floor")}</p>
            )}
            {stage.onDevice && <p className="text-xs text-charcoal-ink/60 dark:text-night-ink/60">{t("symptom.emergency.offline_note")}</p>}
            {!stage.recorded && stage.category !== "emergency" && (
              <p className="text-sm text-charcoal-ink/70 dark:text-night-ink/70">{t("symptom.degraded.not_saved")}</p>
            )}
            {stage.clinicianReviewRequired && !stage.degraded && (
              <p className="text-sm text-charcoal-ink/70 dark:text-night-ink/70">
                A member of our care team will also take a look at this one directly.
              </p>
            )}
            <NotADiagnosis />
            {stage.assessmentId && <ReviewRequest assessmentId={stage.assessmentId} reviewTime={reviewTime} />}
            <SymptomNextSteps
              category={stage.category as TriageCategory}
              urgencyLevel={stage.urgencyLevel as UrgencyLevel | null}
              forDependant={stage.forDependant}
              complaintKey={complaintKey}
              assessmentId={stage.assessmentId}
            />
            {stage.category !== "emergency" && <SkinPhotoCard assessmentId={stage.assessmentId} />}
            <Button type="button" variant="outline" onClick={() => setStage({ step: "pick_complaint" })}>
              Check another symptom
            </Button>
          </div>
        )}

        {stage.step === "unavailable" && (
          <p className="text-sm text-charcoal-ink/70 dark:text-night-ink/70">
            The symptom checker isn&apos;t available right now. If something&apos;s worrying you, please use the emergency
            check above or reach out to your care team.
          </p>
        )}

        <FormError
          id={fieldErrorId("symptom-triage")}
          message={stage.step === "error" && stage.message}
        />
      </CardContent>
    </Card>
  );
}

/**
 * The first screen after choosing a complaint: when it started, how bad, and the safety checklist (spec 12.8). The checklist
 * options come from the BUNDLED signed pathway vocabulary, so this screen works with no connection. Unticked means "not
 * reported", never "ruled out".
 */
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
  const [symptoms, setSymptoms] = useState<string[]>([]);
  const [triggers, setTriggers] = useState<string[]>([]);
  const [history, setHistory] = useState<string[]>([]);
  const vocab = SEED_PATHWAYS.find((p) => p.key === complaintKey);

  const toggle = (list: string[], set: (v: string[]) => void, key: string) =>
    set(list.includes(key) ? list.filter((k) => k !== key) : [...list, key]);

  const group = (title: MessageKey, keys: readonly string[] | undefined, list: string[], set: (v: string[]) => void) =>
    keys && keys.length > 0 ? (
      <fieldset className="space-y-1.5">
        <legend className="text-sm font-medium text-charcoal-ink dark:text-night-ink">{t(title)}</legend>
        <div className="flex flex-col gap-1.5 text-sm">
          {keys.map((k) => (
            <label key={k} className="flex items-center gap-2">
              <input type="checkbox" checked={list.includes(k)} onChange={() => toggle(list, set, k)} />
              {symptomOptionLabel(k)}
            </label>
          ))}
        </div>
      </fieldset>
    ) : null;

  return (
    <form
      className="space-y-4"
      onSubmit={(e) => {
        e.preventDefault();
        onSubmit({
          presentingComplaintKey: complaintKey,
          onset,
          severity,
          associatedSymptoms: symptoms,
          triggers,
          relevantHistory: history,
          measurements: {},
        });
      }}
    >
      <div className="space-y-1">
        <p className="text-sm font-medium text-charcoal-ink dark:text-night-ink">{t("symptom.redflag.title")}</p>
        <p className="text-sm text-charcoal-ink/70 dark:text-night-ink/70">{t("symptom.redflag.intro")}</p>
      </div>

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
          <span className="text-sm font-semibold text-charcoal-ink dark:text-night-ink">{severity}/10</span>
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

      {group("symptom.redflag.symptoms", vocab?.knownAssociatedSymptoms, symptoms, setSymptoms)}
      {group("symptom.redflag.triggers", vocab?.knownTriggers, triggers, setTriggers)}
      {group("symptom.redflag.history", vocab?.knownHistory, history, setHistory)}

      <Button type="submit" disabled={pending}>
        {pending ? "Checking..." : t("symptom.redflag.continue")}
      </Button>
    </form>
  );
}

/** Ask the care team to look at the check (spec 12.10), with the stated time read from the signed SLA, or none. */
function ReviewRequest({ assessmentId, reviewTime }: { assessmentId: string; reviewTime: ReviewTime }) {
  const [state, setState] = useState<"idle" | "sending" | "requested" | "closed" | "error">("idle");
  const [time, setTime] = useState<ReviewTime>(reviewTime);
  return (
    <div className="space-y-2 rounded-lg border border-charcoal-ink/10 p-3 dark:border-night-ink/15">
      {state === "requested" ? (
        <p className="text-sm text-charcoal-ink dark:text-night-ink">{t("symptom.review.requested")}</p>
      ) : (
        <Button
          type="button"
          variant="outline"
          disabled={state === "sending"}
          onClick={async () => {
            setState("sending");
            try {
              const r = await requestSymptomReview(assessmentId);
              if (r.status === "requested") {
                setTime(r.stated);
                setState("requested");
              } else setState(r.status === "unavailable" ? "closed" : "error");
            } catch {
              setState("error");
            }
          }}
        >
          {t("symptom.review.cta")}
        </Button>
      )}
      <p className="text-xs text-charcoal-ink/70 dark:text-night-ink/70">{reviewTimeSentence(time)}</p>
      {state === "closed" && <p className="text-xs text-charcoal-ink/70 dark:text-night-ink/70">{t("symptom.review.closed")}</p>}
      {state === "error" && <p className="text-xs text-red-800">{t("symptom.review.error")}</p>}
    </div>
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
      <p className="text-sm font-medium text-charcoal-ink dark:text-night-ink">{question.prompt}</p>
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
