"use client";

import { useEffect, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { SEMANTIC_ICON } from "@/lib/icons";
import {
  getSymptomTriagePathwaysAction,
  submitSymptomTriageAssessmentAction,
  type SubmitTriageResult,
} from "@/lib/symptom-triage/actions";
import { evaluateRedFlags, measurementKeysForPathway, nextTriageStep, type NodeAnswers } from "@/lib/symptom-triage/engine";
import type { InitialCapture, TriagePathway } from "@/lib/symptom-triage/types";

function humanize(key: string): string {
  return key
    .split("_")
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
}

const CATEGORY_BADGE: Record<string, { variant: "red" | "amber" | "blue" | "green"; label: string }> = {
  emergency: { variant: "red", label: "Emergency" },
  urgent: { variant: "amber", label: "Needs prompt review" },
  routine: { variant: "blue", label: "Routine review" },
  self_management: { variant: "green", label: "Self-care" },
};

type Phase = "loading" | "not_available" | "pick_pathway" | "capture" | "questions" | "result" | "error";

function emptyCapture(): InitialCapture {
  return { severity: 3, onset: "gradual", associatedSymptoms: [], history: [], triggers: [], measurements: {} };
}

function toggleInArray(list: string[], value: string): string[] {
  return list.includes(value) ? list.filter((v) => v !== value) : [...list, value];
}

/**
 * §78.10 structured symptom conversation: Symptom -> structured questions ->
 * risk signal -> pathway. Deliberately NOT free-text-driven -- every
 * question is a fixed checkbox/choice from the active, clinician-signed
 * protocol (triage_protocols), same "can't be gamed into under-reporting"
 * discipline as danger-symptom-check.tsx's DANGER_SIGNS. The disposition
 * shown here is provisional; submitSymptomTriageAssessmentAction()
 * re-resolves it server-side before anything is persisted or escalated.
 */
export function SymptomChecker() {
  const [phase, setPhase] = useState<Phase>("loading");
  const [pathways, setPathways] = useState<TriagePathway[]>([]);
  const [pathway, setPathway] = useState<TriagePathway | null>(null);
  const [capture, setCapture] = useState<InitialCapture>(emptyCapture());
  const [answers, setAnswers] = useState<NodeAnswers>({});
  const [result, setResult] = useState<SubmitTriageResult | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void getSymptomTriagePathwaysAction().then((res) => {
      if (cancelled) return;
      if (res.status === "not_available") {
        setPhase("not_available");
      } else {
        setPathways(res.pathways);
        setPhase("pick_pathway");
      }
    });
    return () => {
      cancelled = true;
    };
  }, []);

  function reset() {
    setPathway(null);
    setCapture(emptyCapture());
    setAnswers({});
    setResult(null);
    setPhase("pick_pathway");
  }

  async function submit(finalAnswers: NodeAnswers) {
    if (!pathway) return;
    setIsSubmitting(true);
    try {
      const res = await submitSymptomTriageAssessmentAction({
        pathwayKey: pathway.key,
        capture,
        answers: finalAnswers,
      });
      setResult(res);
      setPhase(res.status === "not_available" ? "not_available" : "result");
    } finally {
      setIsSubmitting(false);
    }
  }

  async function handleCaptureSubmit() {
    if (!pathway) return;
    // Client-side check purely for a snappy result -- the server redoes this
    // independently before anything is persisted.
    if (evaluateRedFlags(pathway, capture)) {
      await submit({});
      return;
    }
    setPhase("questions");
  }

  async function handleAnswer(nodeKey: string, value: boolean | string) {
    if (!pathway) return;
    const next = { ...answers, [nodeKey]: value };
    setAnswers(next);
    const step = nextTriageStep(pathway, next);
    if (step.type === "outcome") {
      await submit(next);
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <SEMANTIC_ICON.aiCoach className="h-5 w-5 text-deep-forest" strokeWidth={2} />
          Check my symptoms
        </CardTitle>
        <CardDescription>
          A few structured questions to help figure out the right next step -- not a diagnosis.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="rounded-lg border border-red-200 bg-red-50 p-3">
          <p className="text-sm font-medium text-red-700">
            If this is an emergency, don&apos;t wait for this tool — call emergency services or go
            to the nearest hospital now.
          </p>
        </div>

        {phase === "loading" && <p className="text-sm text-charcoal-ink/60">Loading…</p>}

        {phase === "not_available" && !result && (
          <p className="text-sm text-charcoal-ink/60">
            The symptom checker isn&apos;t switched on yet — it&apos;s waiting on clinical sign-off
            before it goes live. For now, use the one-touch emergency check above or message your
            care team.
          </p>
        )}

        {phase === "pick_pathway" && (
          <div className="space-y-2">
            <p className="text-sm text-charcoal-ink/70">What&apos;s bothering you?</p>
            <div className="flex flex-wrap gap-2">
              {pathways.map((p) => (
                <Button
                  key={p.key}
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => {
                    setPathway(p);
                    setPhase("capture");
                  }}
                >
                  {p.label}
                </Button>
              ))}
            </div>
          </div>
        )}

        {phase === "capture" && pathway && (
          <CaptureForm
            pathway={pathway}
            capture={capture}
            onChange={setCapture}
            onSubmit={handleCaptureSubmit}
            onBack={reset}
            isSubmitting={isSubmitting}
          />
        )}

        {phase === "questions" &&
          pathway &&
          (() => {
            const step = nextTriageStep(pathway, answers);
            if (step.type !== "question") return null;
            return (
              <div className="space-y-2">
                <p className="text-sm font-medium text-charcoal-ink">{step.node.prompt}</p>
                {step.node.kind === "boolean" ? (
                  <div className="flex gap-2">
                    <Button size="sm" disabled={isSubmitting} onClick={() => void handleAnswer(step.node.key, true)}>
                      Yes
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={isSubmitting}
                      onClick={() => void handleAnswer(step.node.key, false)}
                    >
                      No
                    </Button>
                  </div>
                ) : (
                  <div className="flex flex-wrap gap-2">
                    {step.node.options.map((option) => (
                      <Button
                        key={option.value}
                        size="sm"
                        variant="outline"
                        disabled={isSubmitting}
                        onClick={() => void handleAnswer(step.node.key, option.value)}
                      >
                        {option.label}
                      </Button>
                    ))}
                  </div>
                )}
                <button type="button" className="text-xs text-charcoal-ink/40 hover:underline" onClick={reset}>
                  Start over
                </button>
              </div>
            );
          })()}

        {phase === "result" && result?.status === "ok" && (
          <div className="space-y-2 rounded-md border border-mist-grey/60 bg-mist-grey/20 p-3">
            <Badge variant={CATEGORY_BADGE[result.category]?.variant ?? "grey"}>
              {CATEGORY_BADGE[result.category]?.label ?? result.category}
            </Badge>
            <p className="text-sm text-charcoal-ink">{result.message}</p>
            {result.clinicianNotified && (
              <p className="text-xs text-charcoal-ink/60">Your care team has been notified.</p>
            )}
            <Button size="sm" variant="outline" onClick={reset}>
              Check another symptom
            </Button>
          </div>
        )}

        {phase === "result" && result?.status === "error" && (
          <div className="space-y-2">
            <p className="text-sm text-charcoal-ink/60">
              Couldn&apos;t save this right now — if you&apos;re worried, message your care team
              directly.
            </p>
            <Button size="sm" variant="outline" onClick={reset}>
              Start over
            </Button>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function CaptureForm({
  pathway,
  capture,
  onChange,
  onSubmit,
  onBack,
  isSubmitting,
}: {
  pathway: TriagePathway;
  capture: InitialCapture;
  onChange: (capture: InitialCapture) => void;
  onSubmit: () => void;
  onBack: () => void;
  isSubmitting: boolean;
}) {
  const measurementKeys = measurementKeysForPathway(pathway);

  return (
    <div className="space-y-3">
      <div className="space-y-1">
        <Label>How severe is it right now, from 0 (barely there) to 10 (worst you can imagine)?</Label>
        <Input
          type="number"
          min={0}
          max={10}
          value={capture.severity}
          onChange={(event) => onChange({ ...capture, severity: Number(event.target.value) })}
          className="w-24"
        />
      </div>

      <div className="space-y-1">
        <Label>Did it come on suddenly, or build up gradually?</Label>
        <div className="flex gap-2">
          <Button
            type="button"
            size="sm"
            variant={capture.onset === "sudden" ? "default" : "outline"}
            onClick={() => onChange({ ...capture, onset: "sudden" })}
          >
            Suddenly
          </Button>
          <Button
            type="button"
            size="sm"
            variant={capture.onset === "gradual" ? "default" : "outline"}
            onClick={() => onChange({ ...capture, onset: "gradual" })}
          >
            Gradually
          </Button>
        </div>
      </div>

      {pathway.knownAssociatedSymptoms.length > 0 && (
        <ChecklistGroup
          label="Are you also having any of these?"
          options={pathway.knownAssociatedSymptoms}
          selected={capture.associatedSymptoms}
          onToggle={(value) => onChange({ ...capture, associatedSymptoms: toggleInArray(capture.associatedSymptoms, value) })}
        />
      )}

      {pathway.knownHistory.length > 0 && (
        <ChecklistGroup
          label="Does any of this apply to you?"
          options={pathway.knownHistory}
          selected={capture.history}
          onToggle={(value) => onChange({ ...capture, history: toggleInArray(capture.history, value) })}
        />
      )}

      {pathway.knownTriggers.length > 0 && (
        <ChecklistGroup
          label="Any of these around when it started?"
          options={pathway.knownTriggers}
          selected={capture.triggers}
          onToggle={(value) => onChange({ ...capture, triggers: toggleInArray(capture.triggers, value) })}
        />
      )}

      {measurementKeys.map((key) => (
        <div key={key} className="space-y-1">
          <Label>{humanize(key)} reading, if you have one (optional)</Label>
          <Input
            type="number"
            value={capture.measurements[key] ?? ""}
            onChange={(event) => {
              const raw = event.target.value;
              const rest = Object.fromEntries(Object.entries(capture.measurements).filter(([k]) => k !== key));
              onChange({
                ...capture,
                measurements: raw === "" ? rest : { ...rest, [key]: Number(raw) },
              });
            }}
            className="w-32"
          />
        </div>
      ))}

      <div className="flex gap-2 pt-1">
        <Button size="sm" disabled={isSubmitting} onClick={onSubmit}>
          {isSubmitting ? "Checking…" : "Continue"}
        </Button>
        <Button size="sm" variant="ghost" onClick={onBack}>
          Back
        </Button>
      </div>
    </div>
  );
}

function ChecklistGroup({
  label,
  options,
  selected,
  onToggle,
}: {
  label: string;
  options: string[];
  selected: string[];
  onToggle: (value: string) => void;
}) {
  return (
    <div className="space-y-1">
      <Label>{label}</Label>
      <div className="flex flex-wrap gap-2">
        {options.map((option) => (
          <Button
            key={option}
            type="button"
            size="sm"
            variant={selected.includes(option) ? "default" : "outline"}
            onClick={() => onToggle(option)}
          >
            {humanize(option)}
          </Button>
        ))}
      </div>
    </div>
  );
}
