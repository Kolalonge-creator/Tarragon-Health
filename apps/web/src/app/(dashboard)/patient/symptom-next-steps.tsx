"use client";

import { useState } from "react";
import Link from "next/link";
import { t, type MessageKey } from "@tarragon/i18n";
import type { TriageCategory, UrgencyLevel } from "@tarragon/symptom-triage-engine";
import { nextSteps, headline, type NextStep } from "@/lib/symptom-triage/next-steps";
import { Button } from "@/components/ui/button";
import {
  attachSummaryToConsultation,
  listUpcomingConsultations,
  previewSymptomSummary,
  sendSymptomSummary,
  type SummaryPreview,
  type UpcomingConsultation,
} from "./symptom-handoff-actions";
import { symptomOptionLabel } from "@/lib/symptom-triage/option-label";

const STEP_LABEL: Record<NextStep["kind"], MessageKey> = {
  emergency_guidance: "symptom.steps.emergency",
  self_care_content: "symptom.steps.self_care",
  pharmacist: "symptom.steps.pharmacist",
  book_consultation: "symptom.steps.book",
  send_summary: "symptom.steps.send_summary",
  message_care_team: "symptom.steps.message",
  lab_or_home_test: "symptom.steps.lab",
  nearest_clinic: "symptom.steps.clinic",
};

/**
 * The headline: the four-category result is always the source of truth. The six-level wording replaces the plain label only when a
 * signed urgency map produced a level (null otherwise, and then nothing but the four-category result is shown).
 */
export function resultHeadline(category: TriageCategory, urgencyLevel: UrgencyLevel | null, categoryLabel: string): string {
  const h = headline(category, urgencyLevel);
  return h.kind === "level" ? t(`symptom.level.${h.level}` as MessageKey) : categoryLabel;
}

/** What to do next after a result (spec 12.5). Every door is an existing route; sending a summary is the person's own click. */
export function SymptomNextSteps(props: {
  category: TriageCategory;
  urgencyLevel: UrgencyLevel | null;
  forDependant: boolean;
  complaintKey: string;
  assessmentId: string | null;
}) {
  const steps = nextSteps(props);
  const [sending, setSending] = useState(false);
  return (
    <div className="space-y-2 rounded-lg border border-charcoal-ink/10 p-3 dark:border-night-ink/15">
      <p className="text-sm font-medium text-charcoal-ink dark:text-night-ink">{t("symptom.steps.title")}</p>
      <ul className="space-y-1.5 text-sm">
        {steps.map((s) => (
          <li key={s.kind}>
            {s.kind === "send_summary" && props.assessmentId ? (
              <SendSummary assessmentId={props.assessmentId} open={sending} onToggle={() => setSending((v) => !v)} />
            ) : s.href ? (
              <Link href={s.href} className="font-medium text-brand-green hover:underline">
                {t(STEP_LABEL[s.kind])}
              </Link>
            ) : (
              <span className="text-charcoal-ink dark:text-night-ink">{t(STEP_LABEL[s.kind])}</span>
            )}
          </li>
        ))}
      </ul>
      {props.forDependant && props.category !== "emergency" && (
        <p className="text-xs text-charcoal-ink/70 dark:text-night-ink/70">{t("symptom.steps.child_note")}</p>
      )}
      {props.urgencyLevel === null && props.category !== "emergency" && (
        <p className="text-xs text-charcoal-ink/60 dark:text-night-ink/60">{t("symptom.steps.unsigned_note")}</p>
      )}
    </div>
  );
}

function SendSummary({ assessmentId, open, onToggle }: { assessmentId: string; open: boolean; onToggle: () => void }) {
  const [preview, setPreview] = useState<SummaryPreview | null>(null);
  const [appointments, setAppointments] = useState<UpcomingConsultation[]>([]);
  const [pick, setPick] = useState<string>("");
  const [state, setState] = useState<"idle" | "sending" | "sent" | "closed" | "error">("idle");
  const [linked, setLinked] = useState(false);
  const [summaryId, setSummaryId] = useState<string | null>(null);

  async function openPanel() {
    onToggle();
    if (!open) {
      const [p, a] = await Promise.all([previewSymptomSummary(assessmentId), listUpcomingConsultations()]);
      setPreview(p);
      setAppointments(a);
      setPick(a[0]?.id ?? "");
    }
  }

  async function send() {
    setState("sending");
    try {
      const r = await sendSymptomSummary(assessmentId, pick || null);
      if (r.status === "sent") {
        setSummaryId(r.summaryId);
        setLinked(r.linked);
        setState("sent");
      } else setState(r.status === "unavailable" ? "closed" : "error");
    } catch {
      setState("error");
    }
  }

  async function attachLater() {
    if (!summaryId || !pick) return;
    const r = await attachSummaryToConsultation(summaryId, pick);
    if (r.ok) setLinked(true);
  }

  return (
    <div className="space-y-2">
      <button type="button" onClick={openPanel} className="font-medium text-brand-green hover:underline">
        {t("symptom.steps.send_summary")}
      </button>
      {open && (
        <div className="space-y-2 rounded-md bg-charcoal-ink/5 p-3 text-sm dark:bg-night-ink/10">
          <p className="font-medium">{t("symptom.summary.title")}</p>
          <p className="text-xs">{t("symptom.summary.intro")}</p>
          {preview && (
            <dl className="space-y-1 text-xs">
              <div>
                <dt className="font-medium">{t("symptom.summary.complaint")}</dt>
                <dd>{symptomOptionLabel(preview.complaintKey)}</dd>
              </div>
              <div>
                <dt className="font-medium">{t("symptom.summary.reported")}</dt>
                <dd>
                  {[preview.onset, preview.severity !== null ? `${preview.severity}/10` : null, ...preview.symptoms.map(symptomOptionLabel), ...preview.history.map(symptomOptionLabel)]
                    .filter(Boolean)
                    .join(", ")}
                </dd>
                {preview.questions.length > 0 && (
                  <dd>
                    <ul className="list-disc pl-4">
                      {preview.questions.map((q, i) => (
                        <li key={i}>
                          {q.prompt} {q.answer}
                        </li>
                      ))}
                    </ul>
                  </dd>
                )}
              </div>
            </dl>
          )}
          <p className="text-xs">{t("symptom.summary.pregnancy_note")}</p>
          {state !== "sent" && (
            <>
              {appointments.length > 0 ? (
                <label className="block text-xs">
                  {t("symptom.summary.pick_appointment")}
                  <select className="mt-1 block w-full rounded border border-charcoal-ink/20 bg-transparent p-1" value={pick} onChange={(e) => setPick(e.target.value)}>
                    <option value="">-</option>
                    {appointments.map((a) => (
                      <option key={a.id} value={a.id}>
                        {new Date(a.scheduledFor).toLocaleString("en-GB", { dateStyle: "medium", timeStyle: "short", timeZone: "Africa/Lagos" })}
                      </option>
                    ))}
                  </select>
                </label>
              ) : (
                <p className="text-xs">{t("symptom.summary.no_appointment")}</p>
              )}
              <Button type="button" disabled={state === "sending"} onClick={send}>
                {t("symptom.summary.send")}
              </Button>
            </>
          )}
          {state === "sent" && (
            <div className="space-y-1">
              <p>{linked ? t("symptom.summary.attached") : t("symptom.summary.sent")}</p>
              {!linked && pick && (
                <Button type="button" variant="outline" onClick={attachLater}>
                  {t("symptom.summary.pick_appointment")}
                </Button>
              )}
            </div>
          )}
          {state === "closed" && <p className="text-xs">{t("symptom.summary.closed")}</p>}
          {state === "error" && <p className="text-xs text-red-800">{t("symptom.summary.error")}</p>}
        </div>
      )}
    </div>
  );
}
