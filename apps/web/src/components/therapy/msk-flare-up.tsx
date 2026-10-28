"use client";

import { useState } from "react";
import { readEntryQuestions, readFlareUpOutcome, type EntryQuestions, type TherapyAnswers } from "@tarragon/shared";
import { t } from "@tarragon/i18n";
import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { TherapyGuidanceCard } from "./guidance-card";
import { TherapyQuestionForm } from "./question-form";

type View =
  | { kind: "button" }
  | { kind: "loading" }
  | { kind: "form"; questions: EntryQuestions }
  | { kind: "stopped"; route: "crisis" | "same_day_clinician" | "medical_review_first" | "education_only" | null; taskFailed: boolean }
  | { kind: "step_down"; until: string }
  | { kind: "message"; text: string };

/**
 * "My pain got worse" (S96). It never just continues the plan: it asks the red-flag questions again (the database re-runs the same
 * deterministic screen, failing closed). A positive pauses the plan and raises a task for the care team; a clear check gives a lighter
 * plan for a few days and records it. No model is involved.
 */
export function MskFlareUp({ enrolmentId, programmeCode }: { enrolmentId: string; programmeCode: string }) {
  const [view, setView] = useState<View>({ kind: "button" });
  const [busy, setBusy] = useState(false);
  const [pain, setPain] = useState("");

  async function open() {
    setView({ kind: "loading" });
    try {
      const { data, error } = await createClient().rpc("get_therapy_entry_questions", { p_programme_code: programmeCode });
      const questions = error ? null : readEntryQuestions(data);
      setView(questions ? { kind: "form", questions } : { kind: "message", text: t("therapy.msk.flare_error") });
    } catch {
      setView({ kind: "message", text: t("therapy.msk.flare_error") });
    }
  }

  async function submit(answers: TherapyAnswers) {
    setBusy(true);
    try {
      const painNow = /^\d{1,2}$/.test(pain) && Number(pain) <= 10 ? Number(pain) : undefined;
      const { data, error } = await createClient().rpc("report_msk_flare_up", {
        p_enrolment: enrolmentId,
        p_recheck: answers as unknown as Record<string, boolean | number>,
        p_pain_now: painNow,
      });
      const o = error ? ({ kind: "unknown" } as const) : readFlareUpOutcome(data);
      if (o.kind === "stopped") setView({ kind: "stopped", route: o.route, taskFailed: o.taskFailed });
      else if (o.kind === "step_down") setView({ kind: "step_down", until: o.until });
      else if (o.kind === "not_active") setView({ kind: "message", text: t("therapy.msk.flare_not_active") });
      else setView({ kind: "message", text: t("therapy.msk.flare_error") });
    } catch {
      setView({ kind: "message", text: t("therapy.msk.flare_error") });
    } finally {
      setBusy(false);
    }
  }

  if (view.kind === "button") {
    return <Button type="button" variant="outline" onClick={() => void open()}>{t("therapy.msk.flare_button")}</Button>;
  }
  if (view.kind === "loading") return <p className="text-sm" role="status">{t("therapy.player.starting")}</p>;
  if (view.kind === "message") return <p role="alert" className="text-sm">{view.text}</p>;
  if (view.kind === "stopped") {
    return (
      <div className="space-y-3">
        <p role="status" className="text-sm font-medium">{view.route === "crisis" ? null : t("therapy.msk.flare_paused")}</p>
        <TherapyGuidanceCard route={view.route} taskFailed={view.taskFailed} />
      </div>
    );
  }
  if (view.kind === "step_down") {
    return (
      <Card>
        <CardContent className="space-y-2 py-4">
          <p role="status" className="text-sm font-medium">{t("therapy.msk.flare_step_down")}</p>
          <p className="text-sm">{t("therapy.msk.step_down_banner", "en", { date: view.until })}</p>
        </CardContent>
      </Card>
    );
  }
  return (
    <Card>
      <CardHeader><CardTitle className="text-base">{t("therapy.msk.flare_title")}</CardTitle></CardHeader>
      <CardContent className="space-y-4">
        <p className="text-sm">{t("therapy.msk.flare_intro")}</p>
        <div className="space-y-1">
          <label htmlFor="msk-pain-now" className="text-sm">{t("therapy.msk.flare_pain_now")}</label>
          <input
            id="msk-pain-now"
            inputMode="numeric"
            autoComplete="off"
            value={pain}
            onChange={(e) => setPain(e.target.value.replace(/\D/g, "").slice(0, 2))}
            className="block w-20 rounded-md border border-charcoal-ink/20 dark:border-night-ink/25 bg-transparent px-2 py-1.5 text-sm"
          />
        </div>
        <TherapyQuestionForm questions={view.questions.questions} submitLabel={t("therapy.msk.flare_submit")} busy={busy} onSubmit={(a) => void submit(a)} />
      </CardContent>
    </Card>
  );
}
