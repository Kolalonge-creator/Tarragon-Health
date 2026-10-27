"use client";

import { useState } from "react";
import Link from "next/link";
import { t, type MessageKey } from "@tarragon/i18n";
import {
  CARE_OPTIONS,
  PROGRESS_OPTIONS,
  checkbackDoorCategory,
  checkbackResultKey,
  evaluateBundledRedFlags,
  type CheckbackAction,
  type CheckbackCare,
  type CheckbackProgress,
  type SafetyNetConfig,
} from "@tarragon/symptom-triage-engine";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { NotADiagnosis } from "@/components/symptom/not-a-diagnosis";
import { SafetyNetBlock } from "@/components/symptom/safety-net-block";
import { symptomOptionLabel } from "@/lib/symptom-triage/option-label";
import type { CheckbackView } from "@/lib/symptom-checkback/model";
import { SymptomNextSteps } from "../../symptom-next-steps";
import { submitCheckbackAction } from "./actions";

type Done = { action: CheckbackAction; doctorAccess: boolean | null; told: boolean; recorded: boolean };

/**
 * S59c: "How are you getting on?" The structured follow-up: better, same or worse; did you get care; and any warning sign that has started
 * since (ticked from the pathway's own vocabulary, so nothing free-form reaches an alert). Order of events is the safety rule: the red-flag
 * floor is re-run on THIS device on the original answers plus what was newly ticked, and an emergency is shown at once whatever the server
 * does. The server re-runs it from the stored answers and records the result; if the server cannot be reached the person is told so and
 * pointed to the safe routes, never to "all clear". Answering is optional: nothing here blocks anything else in the app.
 */
export function CheckbackForm({ view, safetyNet }: { view: CheckbackView; safetyNet: SafetyNetConfig | null }) {
  const [progress, setProgress] = useState<CheckbackProgress | null>(null);
  const [care, setCare] = useState<CheckbackCare | null>(null);
  const [signs, setSigns] = useState<string[]>([]);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<"failed" | "closed" | null>(null);
  const [done, setDone] = useState<Done | null>(
    view.state === "answered" && view.outcome ? { action: view.outcome.action, doctorAccess: view.outcome.doctor_access ?? null, told: Boolean(view.outcome.alert_raised || view.outcome.emergency), recorded: true } : null,
  );

  if (view.state === "scheduled" || view.state === "cancelled") {
    return <p className="text-sm text-charcoal-ink/80 dark:text-night-ink/80">{t("symptom.checkback.gone")}</p>;
  }

  if (done) {
    const door = checkbackDoorCategory(done.action);
    return (
      <Card>
        <CardContent className="space-y-3 pt-6" role="status">
          <p className="text-sm font-medium text-charcoal-ink dark:text-night-ink">{t(checkbackResultKey(done.action, done.doctorAccess) as MessageKey)}</p>
          {done.told && done.action !== "emergency" && <p className="text-sm text-charcoal-ink/80 dark:text-night-ink/80">{t("symptom.checkback.result.told")}</p>}
          {!done.recorded && <p className="text-sm text-charcoal-ink/80 dark:text-night-ink/80">{t("symptom.checkback.error")}</p>}
          <NotADiagnosis />
          {done.action !== "close" && done.action !== "emergency" && <SafetyNetBlock pathwayKey={view.complaint_key} category={door} config={safetyNet} />}
          {done.action !== "close" && (
            <SymptomNextSteps category={door} urgencyLevel={null} forDependant={false} complaintKey={view.complaint_key} assessmentId={view.assessment_id} />
          )}
          <Link href="/patient/vitals#symptom-check" className="text-sm font-medium text-brand-green hover:underline">
            {t("symptom.mobile.again")}
          </Link>
        </CardContent>
      </Card>
    );
  }

  async function send() {
    if (!progress) return;
    setPending(true);
    setError(null);
    // 1. the floor, on this device, on the original answers plus what is newly ticked
    let localEmergency = false;
    try {
      localEmergency = evaluateBundledRedFlags({ ...view.capture, associatedSymptoms: [...new Set([...view.capture.associatedSymptoms, ...signs])] }).topCategory === "emergency";
    } catch {
      localEmergency = false;
    }
    if (localEmergency) setDone({ action: "emergency", doctorAccess: null, told: false, recorded: false });
    // 2. the server re-runs it from the stored answers, decides and records
    try {
      const res = await submitCheckbackAction({ checkbackId: view.id, progress, care, signs });
      if (res.ok) {
        setDone({ action: res.outcome.action, doctorAccess: res.outcome.doctor_access ?? null, told: res.outcome.alert_raised || res.outcome.emergency, recorded: true });
      } else if (!localEmergency) {
        setError(res.reason === "closed" ? "closed" : "failed");
      }
    } catch {
      if (!localEmergency) setError("failed");
    }
    setPending(false);
  }

  const toggle = (k: string) => setSigns((s) => (s.includes(k) ? s.filter((x) => x !== k) : [...s, k]));

  return (
    <Card>
      <CardContent className="space-y-5 pt-6">
        <div>
          <p className="text-sm font-medium text-charcoal-ink dark:text-night-ink">{view.complaint_label}</p>
          <p className="text-sm text-charcoal-ink/80 dark:text-night-ink/80">{t("symptom.checkback.intro")}</p>
        </div>

        <fieldset className="space-y-1.5">
          <legend className="text-sm font-medium text-charcoal-ink dark:text-night-ink">{t("symptom.checkback.q_progress")}</legend>
          {PROGRESS_OPTIONS.map((p) => (
            <label key={p} className="flex items-center gap-2 text-sm">
              <input type="radio" name="progress" checked={progress === p} onChange={() => setProgress(p)} />
              {t(`symptom.checkback.progress.${p}` as MessageKey)}
            </label>
          ))}
        </fieldset>

        <fieldset className="space-y-1.5">
          <legend className="text-sm font-medium text-charcoal-ink dark:text-night-ink">{t("symptom.checkback.q_care")}</legend>
          {CARE_OPTIONS.map((c) => (
            <label key={c} className="flex items-center gap-2 text-sm">
              <input type="radio" name="care" checked={care === c} onChange={() => setCare(c)} />
              {t(`symptom.checkback.care.${c}` as MessageKey)}
            </label>
          ))}
        </fieldset>

        {view.sign_vocabulary.length > 0 && (
          <fieldset className="space-y-1.5">
            <legend className="text-sm font-medium text-charcoal-ink dark:text-night-ink">{t("symptom.checkback.q_signs")}</legend>
            {view.sign_vocabulary.map((k) => (
              <label key={k} className="flex items-center gap-2 text-sm">
                <input type="checkbox" checked={signs.includes(k)} onChange={() => toggle(k)} />
                {symptomOptionLabel(k)}
              </label>
            ))}
          </fieldset>
        )}

        {error && (
          <p role="alert" className="text-sm text-red-700">
            {t(error === "closed" ? "symptom.checkback.closed" : "symptom.checkback.error")}
          </p>
        )}
        <div className="flex flex-wrap gap-2">
          <Button type="button" disabled={!progress || pending} onClick={send}>
            {t("symptom.checkback.submit")}
          </Button>
          <Link href="/patient/vitals#symptom-check" className="inline-flex items-center text-sm font-medium text-brand-green hover:underline">
            {t("symptom.checkback.skip")}
          </Link>
        </div>
        <NotADiagnosis variant="short" />
      </CardContent>
    </Card>
  );
}
