"use client";

import { useCallback, useEffect, useState } from "react";
import {
  cacheSession, enqueueCompletion, flushQueue, readCachedSession,
  type AsyncStore, type CachedSession, type TherapyAnswers, type TherapyRoute,
} from "@tarragon/shared";
import { t, type MessageKey } from "@tarragon/i18n";
import { createClient } from "@/lib/supabase/client";
import {
  readCompleteOutcome, readEntryQuestions, readStartOutcome, type EntryQuestions, type SessionContent,
} from "@tarragon/shared";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { TherapyGuidanceCard } from "./guidance-card";
import { TherapyQuestionForm } from "./question-form";

/** Device storage for the offline copy and the queue. A blocked store only costs the offline convenience. */
const deviceStore: AsyncStore = {
  getItem: (k) => { try { return window.localStorage.getItem(k); } catch { return null; } },
  setItem: (k, v) => { window.localStorage.setItem(k, v); },
  removeItem: (k) => { try { window.localStorage.removeItem(k); } catch { /* nothing to do */ } },
};

const DIARY_KEY = (enrolmentId: string) => `tarragon.therapy.diary.v1.${enrolmentId}`;

type View =
  | { kind: "loading" }
  | { kind: "recheck"; questions: EntryQuestions }
  | { kind: "session"; session: SessionContent | CachedSession; offlineCopy: boolean }
  | { kind: "stopped"; route: TherapyRoute | null }
  | { kind: "finished"; programmeCompleted: boolean; pausedForReview: boolean; queued: boolean }
  | { kind: "message"; key: MessageKey };

function asContent(s: SessionContent | CachedSession) {
  return "programmeCode" in s
    ? { title: s.title, text: s.text, ordinal: s.ordinal, total: s.totalSessions, programmeTitle: s.programmeTitle, checkpoint: s.checkpoint, instruments: s.instruments, draft: s.draftContent, audioReady: s.audioBytes !== null }
    : { title: s.title, text: s.text, ordinal: s.ordinal, total: s.totalSessions, programmeTitle: s.programmeTitle, checkpoint: s.checkpoint, instruments: s.instruments, draft: false, audioReady: false };
}

/**
 * The guided session player (web). Text first and low-data: nothing is downloaded but the session text, and a recording is offered only
 * once one exists and is signed (none does yet, so the text is what plays). Before every session the entry questions are asked again and
 * fail closed. An opened session is kept on this device so it can be read again with no signal, and a finished session that cannot be
 * sent is queued on this device and sent when the connection returns. A diary note stays on this device and is never sent.
 */
export function TherapySessionPlayer({ enrolmentId, programmeCode, ordinal }: { enrolmentId: string; programmeCode: string; ordinal: number }) {
  const [view, setView] = useState<View>({ kind: "loading" });
  const [busy, setBusy] = useState(false);
  const [scores, setScores] = useState<Record<string, string>>({});
  const [scoreError, setScoreError] = useState(false);
  const [diary, setDiary] = useState("");

  const sendQueued = useCallback(async () => {
    await flushQueue(deviceStore, async (item) => {
      const { data, error } = await createClient().rpc("complete_therapy_session", {
        p_enrolment: item.enrolmentId, p_ordinal: item.ordinal, p_scores: item.scores ?? undefined,
      });
      if (error) return /not started|not found|out of range|missing|unknown score|asked only/i.test(error.message) ? "sent" : "retry";
      return readCompleteOutcome(data).kind === "unknown" ? "retry" : "sent";
    });
  }, []);

  useEffect(() => {
    let cancelled = false;
    void sendQueued();
    window.addEventListener("online", sendQueued);
    (async () => {
      try {
        setDiary(window.localStorage.getItem(DIARY_KEY(enrolmentId)) ?? "");
      } catch { /* no diary store */ }
      try {
        const { data, error } = await createClient().rpc("get_therapy_entry_questions", { p_programme_code: programmeCode });
        const questions = error ? null : readEntryQuestions(data);
        if (cancelled) return;
        if (questions) { setView({ kind: "recheck", questions }); return; }
      } catch { /* offline */ }
      const cached = await readCachedSession(deviceStore, enrolmentId, ordinal);
      if (cancelled) return;
      setView(cached ? { kind: "session", session: cached, offlineCopy: true } : { kind: "message", key: "therapy.player.error" });
    })();
    return () => { cancelled = true; window.removeEventListener("online", sendQueued); };
  }, [enrolmentId, programmeCode, ordinal, sendQueued]);

  async function start(answers: TherapyAnswers) {
    setBusy(true);
    try {
      const { data, error } = await createClient().rpc("start_therapy_session", {
        p_enrolment: enrolmentId, p_ordinal: ordinal, p_recheck: answers as unknown as Record<string, boolean | number>,
      });
      const outcome = error ? ({ kind: "unknown" } as const) : readStartOutcome(data);
      switch (outcome.kind) {
        case "ok": {
          const s = outcome.session;
          await cacheSession(deviceStore, enrolmentId, {
            title: s.title, kind: s.kind, text: s.text, ordinal: s.ordinal, totalSessions: s.totalSessions, programmeTitle: s.programmeTitle,
            checkpoint: s.checkpoint, instruments: s.instruments, cachedAt: new Date().toISOString(),
          });
          setView({ kind: "session", session: s, offlineCopy: false });
          break;
        }
        case "stopped": setView({ kind: "stopped", route: outcome.route }); break;
        case "not_active": setView({ kind: "message", key: "therapy.player.not_active" }); break;
        case "content_not_approved": setView({ kind: "message", key: "therapy.player.content_pending" }); break;
        case "not_open_yet": setView({ kind: "message", key: "therapy.enrol.not_open" }); break;
        default: setView({ kind: "message", key: "therapy.player.error" });
      }
    } catch {
      setView({ kind: "message", key: "therapy.player.error" });
    } finally {
      setBusy(false);
    }
  }

  async function finish() {
    if (view.kind !== "session") return;
    const c = asContent(view.session);
    let payload: Record<string, number> | null = null;
    if (c.checkpoint) {
      const parsed: Record<string, number> = {};
      for (const key of c.instruments) {
        const raw = scores[key];
        if (raw === undefined || raw === "" || !/^\d{1,3}$/.test(raw)) { setScoreError(true); return; }
        parsed[key] = Number(raw);
      }
      payload = parsed;
    }
    setScoreError(false);
    setBusy(true);
    try {
      const { data, error } = await createClient().rpc("complete_therapy_session", { p_enrolment: enrolmentId, p_ordinal: ordinal, p_scores: payload ?? undefined });
      const outcome = error ? ({ kind: "unknown" } as const) : readCompleteOutcome(data);
      if (outcome.kind === "ok") {
        setView({ kind: "finished", programmeCompleted: outcome.programmeCompleted, pausedForReview: outcome.pausedForReview, queued: false });
        return;
      }
      if (outcome.kind === "not_active") { setView({ kind: "message", key: "therapy.player.not_active" }); return; }
      throw new Error("not saved");
    } catch {
      const queued = await enqueueCompletion(deviceStore, { enrolmentId, ordinal, scores: payload, queuedAt: new Date().toISOString() });
      setView(queued ? { kind: "finished", programmeCompleted: false, pausedForReview: false, queued: true } : { kind: "message", key: "therapy.player.finish_error" });
    } finally {
      setBusy(false);
    }
  }

  function saveDiary(value: string) {
    setDiary(value);
    // device first: the note is written to this device only. Nothing here sends it anywhere; an opt-in upload would have to pass mayUploadDiary and no screen offers one yet.
    try { window.localStorage.setItem(DIARY_KEY(enrolmentId), value); } catch { /* a blocked store only costs the diary */ }
  }

  if (view.kind === "loading") return <p className="text-sm" role="status">{t("therapy.player.starting")}</p>;
  if (view.kind === "message") return <p role="alert" className="text-sm text-red-600 dark:text-red-400">{t(view.key)}</p>;
  if (view.kind === "stopped") return <TherapyGuidanceCard route={view.route} />;
  if (view.kind === "finished") {
    return (
      <Card>
        <CardContent className="space-y-2 py-4">
          <p role="status" className="text-sm font-medium">
            {view.queued ? t("therapy.player.saved_offline") : view.programmeCompleted ? t("therapy.player.programme_done") : t("therapy.player.done")}
          </p>
          {view.pausedForReview && <p className="text-sm">{t("therapy.player.paused_review")}</p>}
        </CardContent>
      </Card>
    );
  }
  if (view.kind === "recheck") {
    return (
      <Card>
        <CardHeader><CardTitle className="text-base">{t("therapy.player.recheck_title")}</CardTitle></CardHeader>
        <CardContent className="space-y-4">
          <p className="text-sm text-charcoal-ink/80 dark:text-night-ink/80">{t("therapy.player.recheck_intro")}</p>
          <TherapyQuestionForm questions={view.questions.questions} submitLabel={t("therapy.player.start")} busy={busy} onSubmit={start} />
        </CardContent>
      </Card>
    );
  }

  const c = asContent(view.session);
  return (
    <Card>
      <CardHeader>
        <p className="text-xs text-charcoal-ink/70 dark:text-night-ink/70">{c.programmeTitle} · {t("therapy.player.session_of", "en", { n: c.ordinal, total: c.total })}</p>
        <CardTitle className="text-base">{c.title}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {c.draft && <p className="rounded-md border border-amber-300 p-2 text-xs">{t("therapy.programme.draft_notice")}</p>}
        <p className="text-xs text-charcoal-ink/70 dark:text-night-ink/70">{c.audioReady ? t("therapy.player.audio_note") : t("therapy.player.audio_none")}</p>
        <section aria-label={t("therapy.player.text_heading")}>
          <h2 className="text-sm font-semibold">{t("therapy.player.text_heading")}</h2>
          <p className="mt-1 whitespace-pre-line text-sm leading-relaxed">{c.text}</p>
        </section>
        <section className="space-y-1">
          <label htmlFor="therapy-diary" className="text-xs text-charcoal-ink/70 dark:text-night-ink/70">{t("therapy.diary.note")}</label>
          <textarea
            id="therapy-diary"
            value={diary}
            onChange={(e) => saveDiary(e.target.value)}
            maxLength={1000}
            rows={3}
            className="block w-full rounded-md border border-charcoal-ink/20 dark:border-night-ink/25 bg-transparent px-2 py-1.5 text-sm"
          />
        </section>
        {c.checkpoint && (
          <section className="space-y-3">
            <h2 className="text-sm font-semibold">{t("therapy.player.scores_title")}</h2>
            <p className="text-xs text-charcoal-ink/70 dark:text-night-ink/70">{t("therapy.player.scores_intro")}</p>
            {c.instruments.map((key) => (
              <div key={key} className="space-y-1">
                <label htmlFor={`score-${key}`} className="text-sm">{t(`therapy.instrument.${key}` as MessageKey)}</label>
                <input
                  id={`score-${key}`}
                  inputMode="numeric"
                  autoComplete="off"
                  value={scores[key] ?? ""}
                  onChange={(e) => setScores((s) => ({ ...s, [key]: e.target.value.replace(/\D/g, "").slice(0, 3) }))}
                  className="block w-24 rounded-md border border-charcoal-ink/20 dark:border-night-ink/25 bg-transparent px-2 py-1.5 text-sm"
                />
              </div>
            ))}
            {scoreError && <p role="alert" className="text-sm text-red-600 dark:text-red-400">{t("therapy.player.scores_needed")}</p>}
          </section>
        )}
        <Button type="button" onClick={finish} disabled={busy}>{busy ? t("therapy.player.finishing") : t("therapy.player.finish")}</Button>
      </CardContent>
    </Card>
  );
}
