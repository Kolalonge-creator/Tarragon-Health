"use client";

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { t, type Locale, type MessageKey } from "@tarragon/i18n";
import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import {
  cleanAnswers,
  INTAKE_ANSWER_KEYS,
  INTAKE_DURATIONS,
  INTAKE_MAX_ANSWER_CHARS,
  INTAKE_MAX_REASON_CHARS,
  problemsBeforeSend,
  type IntakeAnswerKey,
  type IntakeDraft,
  type IntakeDuration,
} from "@/lib/consultations/intake";

interface StoredIntake {
  state: "draft" | "sent";
  reason: string | null;
  duration: IntakeDuration | null;
  answers: Partial<Record<IntakeAnswerKey, string>>;
  summary: string | null;
}

/** S64 (15.3): the patient's manual intake. Nothing reaches the care team until Send; a sent intake cannot be changed. */
export function IntakeForm({ appointmentId, locale = "en" }: { appointmentId: string; locale?: Locale }) {
  const queryClient = useQueryClient();
  const key = ["consultations", "intake", appointmentId] as const;
  const { data: stored, isLoading } = useQuery({
    queryKey: key,
    queryFn: async () => {
      const supabase = createClient();
      // RLS: the patient reads only their own row
      const { data, error } = await supabase
        .from("consultation_intakes" as never)
        .select("state, reason, duration, answers, summary")
        .eq("appointment_id" as never, appointmentId as never)
        .maybeSingle();
      if (error) throw error;
      return (data ?? null) as unknown as StoredIntake | null;
    },
  });

  const [draft, setDraft] = useState<IntakeDraft | null>(null);
  const [notice, setNotice] = useState<{ tone: "ok" | "error"; key: MessageKey } | null>(null);
  const form: IntakeDraft = draft ?? { reason: stored?.reason ?? "", duration: stored?.duration ?? "", answers: stored?.answers ?? {} };

  const save = useMutation({
    mutationFn: async () => {
      const supabase = createClient();
      const { error } = await supabase.rpc("save_consultation_intake_draft" as never, {
        p_appointment: appointmentId,
        p_reason: form.reason.trim() || null,
        p_duration: form.duration || null,
        p_answers: cleanAnswers(form.answers),
      } as never);
      if (error) throw error;
    },
  });
  const send = useMutation({
    mutationFn: async () => {
      const supabase = createClient();
      // the answers are saved first, so what is sent is exactly what is on screen
      const saved = await supabase.rpc("save_consultation_intake_draft" as never, {
        p_appointment: appointmentId,
        p_reason: form.reason.trim() || null,
        p_duration: form.duration || null,
        p_answers: cleanAnswers(form.answers),
      } as never);
      if (saved.error) throw saved.error;
      const { error } = await supabase.rpc("send_consultation_intake" as never, { p_appointment: appointmentId } as never);
      if (error) throw error;
    },
  });

  if (isLoading) return null;

  if (stored?.state === "sent") {
    return (
      <div className="w-full space-y-1 rounded-md border border-brand-green/30 bg-brand-green/5 p-3 text-sm" data-testid="intake-sent">
        <p className="font-medium">{t("intake.sent", locale)}</p>
        {stored.summary && <p className="whitespace-pre-line text-charcoal-ink/70 dark:text-night-ink/70">{stored.summary}</p>}
      </div>
    );
  }

  const problems = problemsBeforeSend(form);
  const busy = save.isPending || send.isPending;

  return (
    <form
      className="w-full space-y-3 rounded-md border border-charcoal-ink/10 p-3 text-sm dark:border-night-ink/15"
      onSubmit={(e) => e.preventDefault()}
      aria-label={t("intake.title", locale)}
    >
      <p className="font-medium">{t("intake.title", locale)}</p>
      <p className="text-xs text-charcoal-ink/60 dark:text-night-ink/60">{t("intake.help", locale)}</p>
      <p role="note" className="rounded-md bg-amber-50 p-2 text-xs text-charcoal-ink dark:bg-amber-500/10 dark:text-night-ink">{t("intake.emergency", locale)}</p>

      <div className="space-y-1">
        <label htmlFor={`intake-reason-${appointmentId}`} className="text-xs">{t("intake.reason", locale)}</label>
        <Textarea
          id={`intake-reason-${appointmentId}`}
          rows={2}
          maxLength={INTAKE_MAX_REASON_CHARS}
          value={form.reason}
          onChange={(e) => setDraft({ ...form, reason: e.target.value })}
        />
      </div>
      <div className="space-y-1">
        <label htmlFor={`intake-duration-${appointmentId}`} className="text-xs">{t("intake.duration", locale)}</label>
        <Select
          id={`intake-duration-${appointmentId}`}
          value={form.duration}
          onChange={(e) => setDraft({ ...form, duration: e.target.value as IntakeDuration | "" })}
        >
          <option value="" />
          {INTAKE_DURATIONS.map((d) => (
            <option key={d} value={d}>{t(`intake.duration.${d}` as MessageKey, locale)}</option>
          ))}
        </Select>
      </div>
      {INTAKE_ANSWER_KEYS.map((k) => (
        <div key={k} className="space-y-1">
          <label htmlFor={`intake-${k}-${appointmentId}`} className="text-xs">{t(`intake.q.${k}` as MessageKey, locale)}</label>
          <Textarea
            id={`intake-${k}-${appointmentId}`}
            rows={2}
            maxLength={INTAKE_MAX_ANSWER_CHARS}
            value={form.answers[k] ?? ""}
            onChange={(e) => setDraft({ ...form, answers: { ...form.answers, [k]: e.target.value } })}
          />
        </div>
      ))}

      {notice && (
        <p role={notice.tone === "error" ? "alert" : "status"} className={notice.tone === "error" ? "text-red-600 dark:text-red-400" : "text-brand-green dark:text-brand-green-bright"}>
          {t(notice.key, locale)}
        </p>
      )}
      <div className="flex flex-wrap gap-2">
        <Button
          size="sm"
          variant="outline"
          disabled={busy}
          onClick={() =>
            save.mutate(undefined, {
              onSuccess: () => {
                setNotice({ tone: "ok", key: "intake.saved" });
                void queryClient.invalidateQueries({ queryKey: key });
              },
              onError: () => setNotice({ tone: "error", key: "intake.failed" }),
            })
          }
        >
          {t("intake.save", locale)}
        </Button>
        <Button
          size="sm"
          disabled={busy || problems.length > 0}
          onClick={() =>
            send.mutate(undefined, {
              onSuccess: () => {
                setNotice(null);
                void queryClient.invalidateQueries({ queryKey: key });
              },
              onError: () => setNotice({ tone: "error", key: "intake.failed" }),
            })
          }
        >
          {t("intake.send", locale)}
        </Button>
      </div>
    </form>
  );
}
