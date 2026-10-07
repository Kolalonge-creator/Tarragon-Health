"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import {
  evaluateEntryScreen, isTherapyProgrammeCode, therapyExclusionRules, type TherapyAnswers, type TherapyRoute,
} from "@tarragon/shared";
import { t } from "@tarragon/i18n";
import { createClient } from "@/lib/supabase/client";
import { readEnrolOutcome, readEntryQuestions, type EntryQuestion, type EntryQuestions } from "@tarragon/shared";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { TherapyGuidanceCard } from "./guidance-card";
import { TherapyQuestionForm } from "./question-form";

type View =
  | { kind: "loading" }
  | { kind: "form"; data: EntryQuestions; offline: boolean }
  | { kind: "stopped"; route: TherapyRoute | "clinician_review_pending" | "offline_stop" | null; taskFailed: boolean; noRules?: boolean }
  | { kind: "closed" }
  | { kind: "error" };

/**
 * The entry screen (14.9). The database decides: the answers go to enrol_in_therapy_programme, which runs the table-driven screen, fails
 * closed on anything unanswered, and routes a positive to the clinician queue. With no signal the bundled draft list is shown and checked
 * on the device so urgent guidance still appears; starting always needs a connection, because only the server can open a programme.
 */
export function TherapyEntryScreen({ code }: { code: string }) {
  const router = useRouter();
  const [view, setView] = useState<View>({ kind: "loading" });
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const { data, error } = await createClient().rpc("get_therapy_entry_questions", { p_programme_code: code });
        const parsed = error ? null : readEntryQuestions(data);
        if (cancelled) return;
        if (parsed) {
          setView(parsed.open ? { kind: "form", data: parsed, offline: false } : { kind: "closed" });
          return;
        }
      } catch {
        /* offline: fall through to the bundled list */
      }
      if (cancelled) return;
      if (isTherapyProgrammeCode(code) && therapyExclusionRules(code).length > 0) {
        const questions: EntryQuestion[] = therapyExclusionRules(code).map((r) => ({ code: r.code, question: r.question, kind: r.kind }));
        setView({ kind: "form", offline: true, data: { programme: { code, title: "", summary: "", status: "draft" }, open: true, questions } });
      } else {
        setView({ kind: "error" });
      }
    })();
    return () => { cancelled = true; };
  }, [code]);

  async function submit(answers: TherapyAnswers) {
    if (view.kind !== "form") return;
    setBusy(true);
    if (view.offline && isTherapyProgrammeCode(code)) {
      // no signal: the same rule on the device. A stop is shown at once; a pass cannot start a programme without the server.
      const local = evaluateEntryScreen(therapyExclusionRules(code), answers);
      setBusy(false);
      setView(local.passed ? { kind: "error" } : { kind: "stopped", route: "offline_stop", taskFailed: false, noRules: local.noRules });
      return;
    }
    try {
      const { data, error } = await createClient().rpc("enrol_in_therapy_programme", { p_programme_code: code, p_answers: answers as unknown as Record<string, boolean | number> });
      const outcome = error ? ({ kind: "unknown" } as const) : readEnrolOutcome(data);
      if (outcome.kind === "enrolled") {
        router.push(`/patient/programmes/${code}`);
        router.refresh();
        return;
      }
      if (outcome.kind === "blocked") setView({ kind: "stopped", route: outcome.route, taskFailed: outcome.taskFailed });
      else if (outcome.kind === "closed") setView(outcome.reason === "clinician_review_pending" ? { kind: "stopped", route: "clinician_review_pending", taskFailed: false } : { kind: "closed" });
      else setView({ kind: "error" });
    } catch {
      setView({ kind: "error" });
    } finally {
      setBusy(false);
    }
  }

  if (view.kind === "loading") return <p className="text-sm" role="status">{t("therapy.enrol.checking")}</p>;
  if (view.kind === "stopped") return <TherapyGuidanceCard route={view.route} taskFailed={view.taskFailed} noRules={view.noRules} />;
  if (view.kind === "closed") return <TherapyGuidanceCard route={null} noRules />;
  if (view.kind === "error") return <p role="alert" className="text-sm text-red-600 dark:text-red-400">{t("therapy.enrol.error")}</p>;
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">{view.data.programme.title || t("therapy.enrol.title")}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <p className="text-sm text-charcoal-ink/80 dark:text-night-ink/80">{t("therapy.enrol.intro")}</p>
        <TherapyQuestionForm questions={view.data.questions} submitLabel={t("therapy.enrol.submit")} busy={busy} onSubmit={submit} />
      </CardContent>
    </Card>
  );
}
