"use client";

import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { t } from "@tarragon/i18n";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { activeEmergencyKey } from "@/lib/queries/emergency";
import { allAnswered, type CheckinOutcome, type CheckinView } from "@/lib/consult-checkin/model";
import { emergencyHospitalGuidance } from "../../emergency-guidance";
import { submitCheckinAction } from "./actions";

/**
 * The post-consultation check-in. Structured choices plus an optional short note. The wording is the signed configuration's, returned by
 * the database with the check-in. After sending, a red-flag answer shows the SAME hospital guidance the site-wide emergency alert shows, and
 * the active-emergency query is refreshed so that alert takes over the screen at once; nothing here invents emergency text.
 */
export function CheckinForm({ view, patientId }: { view: CheckinView; patientId: string }) {
  const queryClient = useQueryClient();
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [note, setNote] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [outcome, setOutcome] = useState<CheckinOutcome | null>(view.state === "answered" ? view.outcome : null);
  const [closed, setClosed] = useState(view.state !== "open" && view.state !== "answered");

  if (closed) return <p className="text-sm text-charcoal-ink/80 dark:text-night-ink/80">{t("consult.checkin.closed", "en")}</p>;

  if (outcome || view.state === "answered") {
    const o = outcome;
    return (
      <Card>
        <CardContent className="space-y-3 pt-6" role="status">
          {o?.red_flag ? (
            <>
              <p className="font-medium text-charcoal-ink dark:text-night-ink">{t("consult.checkin.red_intro", "en")}</p>
              <p className="text-sm">{emergencyHospitalGuidance(o.alert_raised ? "raised" : null)}</p>
            </>
          ) : o?.concern ? (
            <p className="text-sm">{t("consult.checkin.thanks_concern", "en")}</p>
          ) : o?.follow_up ? (
            <p className="text-sm">{t("consult.checkin.thanks_follow_up", "en")}</p>
          ) : o ? (
            <p className="text-sm">{t("consult.checkin.thanks_ok", "en")}</p>
          ) : (
            <p className="text-sm">{t("consult.checkin.answered", "en")}</p>
          )}
        </CardContent>
      </Card>
    );
  }

  const ready = allAnswered(view, answers);

  async function send() {
    setPending(true);
    setError(null);
    const res = await submitCheckinAction({ checkinId: view.id, answers, note: note.trim() || undefined });
    setPending(false);
    if (!res.ok) {
      if (res.reason === "not_open") setClosed(true);
      else setError(t("consult.checkin.error", "en"));
      return;
    }
    setOutcome(res.outcome);
    if (res.outcome.red_flag) await queryClient.invalidateQueries({ queryKey: activeEmergencyKey(patientId) });
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>{view.title}</CardTitle>
        <p className="text-sm text-charcoal-ink/70 dark:text-night-ink/70">{view.intro}</p>
      </CardHeader>
      <CardContent className="space-y-6">
        {view.questions.map((q) => (
          <fieldset key={q.id} className="space-y-2">
            <legend className="text-sm font-medium text-charcoal-ink dark:text-night-ink">{q.text}</legend>
            <div className="flex flex-col gap-2">
              {q.options.map((o) => (
                <label key={o.code} className="flex items-center gap-2 text-sm">
                  <input
                    type="radio"
                    name={q.id}
                    value={o.code}
                    checked={answers[q.id] === o.code}
                    onChange={() => setAnswers((a) => ({ ...a, [q.id]: o.code }))}
                  />
                  <span>{o.label}</span>
                </label>
              ))}
            </div>
          </fieldset>
        ))}
        <div className="space-y-1">
          <label htmlFor="checkin-note" className="text-sm font-medium text-charcoal-ink dark:text-night-ink">
            {t("consult.checkin.note_label", "en")}
          </label>
          <textarea
            id="checkin-note"
            className="w-full rounded-md border border-charcoal-ink/20 bg-transparent p-2 text-sm"
            rows={3}
            maxLength={view.free_text_max_chars}
            value={note}
            onChange={(e) => setNote(e.target.value)}
            aria-describedby="checkin-note-hint"
          />
          <p id="checkin-note-hint" className="text-xs text-charcoal-ink/60 dark:text-night-ink/60">
            {t("consult.checkin.note_hint", "en")}
          </p>
        </div>
        {error && (
          <p role="alert" className="text-sm text-red-600">
            {error}
          </p>
        )}
        {!ready && <p className="text-xs text-charcoal-ink/60 dark:text-night-ink/60">{t("consult.checkin.pick_all", "en")}</p>}
        <Button onClick={send} disabled={!ready || pending}>
          {pending ? t("consult.checkin.sending", "en") : t("consult.checkin.send", "en")}
        </Button>
      </CardContent>
    </Card>
  );
}
