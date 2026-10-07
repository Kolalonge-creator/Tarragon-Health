import { useCallback, useEffect, useState } from "react";
import { ActivityIndicator, ScrollView, Text, TextInput, View } from "react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";
import {
  cacheSession, clearCachedSession, enqueueCompletion, evaluateEntryScreen, flushQueue, isTherapyProgrammeCode, readCachedSession, therapyExclusionRules, validateScores,
  type CachedSession, type EntryQuestion, type EntryQuestions, type SessionContent, type TherapyAnswers, type TherapyRoute,
} from "@tarragon/shared";
import { t, type MessageKey } from "@tarragon/i18n";
import { HiddenCard, SharedPhoneSettings } from "@/components/mental-health/shared-phone-controls";
import { useSharedPhone } from "@/lib/shared-phone";
import {
  completeSession, currentUserId, deviceStore, diaryKey, enrol, loadEntryQuestions, loadOpenProgrammes, loadSharing, setSharing, startSession, stopEnrolment,
  type EnrolmentRow, type ProgrammeRow,
} from "@/lib/therapy-programmes";
import { spacing } from "@/ui/theme";
import { useLegacyColors } from "@/ui/design";
import { Card, ErrorText, MutedText, PrimaryButton, ScreenTitle, SecondaryButton } from "@/ui/legacy-kit";

type Step =
  | { kind: "list" }
  | { kind: "entry"; programme: ProgrammeRow }
  | { kind: "player"; programme: ProgrammeRow; enrolmentId: string; ordinal: number };

/** Guidance when a programme is stopped. No phone number and no helpline (CMO decision): the crisis card says go to the nearest hospital now. */
function Guidance({ route, taskFailed, onBack }: { route: TherapyRoute | "clinician_review_pending" | "offline_stop" | null; taskFailed?: boolean; onBack: () => void }) {
  const colors = useLegacyColors();
  const key = route ?? "not_available";
  return (
    <Card style={{ gap: 8 }}>
      <Text accessibilityRole="alert" style={{ fontSize: 14.5, fontWeight: "700", color: colors.ink }}>{t(`therapy.guidance.${key}_title` as MessageKey)}</Text>
      <MutedText>{t(`therapy.guidance.${key}` as MessageKey)}</MutedText>
      {taskFailed ? <MutedText>{t("therapy.guidance.task_failed")}</MutedText> : (route === "crisis" || route === "same_day_clinician" || route === "medical_review_first") && <MutedText>{t("therapy.guidance.told")}</MutedText>}
      <SecondaryButton title={t("therapy.guidance.back")} onPress={onBack} />
    </Card>
  );
}

function Questions({ questions, label, busy, onSubmit }: { questions: EntryQuestion[]; label: string; busy: boolean; onSubmit: (a: TherapyAnswers) => void }) {
  const colors = useLegacyColors();
  const [answers, setAnswers] = useState<Record<string, boolean | number | undefined>>({});
  const [missing, setMissing] = useState(false);
  const submit = () => {
    const ok = questions.every((q) => (q.kind === "yes_no" ? typeof answers[q.code] === "boolean" : typeof answers[q.code] === "number"));
    setMissing(!ok);
    if (ok) onSubmit(answers);
  };
  return (
    <View style={{ gap: 12 }}>
      {questions.map((q) => (
        <View key={q.code} style={{ gap: 6 }}>
          <Text style={{ fontSize: 14, color: colors.ink }}>{q.question}</Text>
          {q.kind === "yes_no" ? (
            <View style={{ flexDirection: "row", gap: 8 }}>
              <SecondaryButton title={(answers[q.code] === true ? "* " : "") + t("therapy.enrol.yes")} onPress={() => setAnswers((a) => ({ ...a, [q.code]: true }))} />
              <SecondaryButton title={(answers[q.code] === false ? "* " : "") + t("therapy.enrol.no")} onPress={() => setAnswers((a) => ({ ...a, [q.code]: false }))} />
            </View>
          ) : (
            <TextInput
              accessibilityLabel={t("therapy.enrol.score_label")}
              keyboardType="number-pad"
              value={typeof answers[q.code] === "number" ? String(answers[q.code]) : ""}
              onChangeText={(v) => { const d = v.replace(/\D/g, "").slice(0, 3); setAnswers((a) => ({ ...a, [q.code]: d === "" ? undefined : Number(d) })); }}
              style={{ borderWidth: 1, borderColor: colors.border, borderRadius: 8, padding: 8, width: 90, color: colors.ink }}
            />
          )}
        </View>
      ))}
      {missing && <ErrorText>{t("therapy.enrol.answer_all")}</ErrorText>}
      <PrimaryButton title={label} onPress={submit} loading={busy} />
    </View>
  );
}

function Entry({ programme, onBack, onEnrolled }: { programme: ProgrammeRow; onBack: () => void; onEnrolled: () => void }) {
  const [data, setData] = useState<EntryQuestions | null>(null);
  const [offline, setOffline] = useState(false);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ route: TherapyRoute | "clinician_review_pending" | "offline_stop" | null; taskFailed: boolean; closed?: boolean } | "error" | null>(null);

  useEffect(() => {
    let alive = true;
    loadEntryQuestions(programme.code).then((q) => {
      if (!alive) return;
      if (q) setData(q);
      else if (isTherapyProgrammeCode(programme.code) && therapyExclusionRules(programme.code).length > 0) {
        // no signal: the bundled draft list is checked on the phone so urgent guidance still shows
        setOffline(true);
        setData({ programme: { code: programme.code, title: programme.title, summary: "", status: "draft" }, open: true, questions: therapyExclusionRules(programme.code).map((r) => ({ code: r.code, question: r.question, kind: r.kind })) });
      }
      setLoading(false);
    });
    return () => { alive = false; };
  }, [programme]);

  const submit = async (answers: TherapyAnswers) => {
    setBusy(true);
    if (offline && isTherapyProgrammeCode(programme.code)) {
      const local = evaluateEntryScreen(therapyExclusionRules(programme.code), answers);
      setBusy(false);
      setResult(local.passed ? "error" : { route: local.route ?? "offline_stop", taskFailed: true });
      return;
    }
    const o = await enrol(programme.code, answers);
    setBusy(false);
    if (o.kind === "enrolled") onEnrolled();
    else if (o.kind === "blocked") setResult({ route: o.route, taskFailed: o.taskFailed });
    else if (o.kind === "closed") setResult({ route: o.reason === "clinician_review_pending" ? "clinician_review_pending" : null, taskFailed: false, closed: true });
    else setResult("error");
  };

  if (loading) return <ActivityIndicator />;
  if (result === "error" || !data) return <><ErrorText>{t("therapy.enrol.error")}</ErrorText><SecondaryButton title={t("therapy.guidance.back")} onPress={onBack} /></>;
  if (result) return <Guidance route={result.route} taskFailed={result.taskFailed} onBack={onBack} />;
  if (data.questions.length === 0) return <Guidance route={null} onBack={onBack} />;
  return (
    <Card style={{ gap: 10 }}>
      <Text style={{ fontSize: 15, fontWeight: "700" }}>{programme.title}</Text>
      <MutedText>{t("therapy.enrol.intro")}</MutedText>
      <Questions questions={data.questions} label={t("therapy.enrol.submit")} busy={busy} onSubmit={submit} />
    </Card>
  );
}

type PlayerView =
  | { kind: "loading" }
  | { kind: "recheck"; q: EntryQuestions }
  | { kind: "session"; s: SessionContent | CachedSession; offlineCopy: boolean }
  | { kind: "stopped"; route: TherapyRoute | null; taskFailed: boolean }
  | { kind: "done"; text: MessageKey; paused: boolean }
  | { kind: "message"; key: MessageKey };

function Player({ programme, enrolmentId, ordinal, onBack }: { programme: ProgrammeRow; enrolmentId: string; ordinal: number; onBack: () => void }) {
  const colors = useLegacyColors();
  const [view, setView] = useState<PlayerView>({ kind: "loading" });
  const [busy, setBusy] = useState(false);
  const [scores, setScores] = useState<Record<string, string>>({});
  const [scoreError, setScoreError] = useState(false);
  const [diary, setDiary] = useState("");
  const [shared, setShared] = useState<boolean | null>(null);
  const [userId, setUserId] = useState<string | undefined>(undefined);
  const [saveError, setSaveError] = useState(false);

  const sendQueued = useCallback(async () => {
    const me = await currentUserId();
    if (!me) return;
    setUserId(me);
    await flushQueue(deviceStore, async (item) => {
      const r = await completeSession(item.enrolmentId, item.ordinal, item.scores);
      return r.kind === "network" || r.kind === "unknown" ? "retry" : "sent";
    }, me);
  }, []);

  useEffect(() => {
    let alive = true;
    void sendQueued();
    AsyncStorage.getItem(diaryKey(enrolmentId)).then((v) => alive && setDiary(v ?? "")).catch(() => {});
    loadSharing(enrolmentId).then((v) => alive && setShared(v));
    (async () => {
      const q = await loadEntryQuestions(programme.code);
      if (!alive) return;
      if (q) return setView({ kind: "recheck", q });
      const cached = await readCachedSession(deviceStore, enrolmentId, ordinal);
      if (alive) setView(cached ? { kind: "session", s: cached, offlineCopy: true } : { kind: "message", key: "therapy.player.error" });
    })();
    return () => { alive = false; };
  }, [programme.code, enrolmentId, ordinal, sendQueued]);

  const start = async (answers: TherapyAnswers) => {
    setBusy(true);
    const o = await startSession(enrolmentId, ordinal, answers);
    setBusy(false);
    if (o.kind === "ok") {
      const s = o.session;
      await cacheSession(deviceStore, enrolmentId, { title: s.title, kind: s.kind, text: s.text, ordinal: s.ordinal, totalSessions: s.totalSessions, programmeTitle: s.programmeTitle, checkpoint: s.checkpoint, instruments: s.instruments, cachedAt: new Date().toISOString() });
      setView({ kind: "session", s, offlineCopy: false });
    } else if (o.kind === "stopped") setView({ kind: "stopped", route: o.route, taskFailed: o.taskFailed });
    else if (o.kind === "not_active") setView({ kind: "message", key: "therapy.player.not_active" });
    else if (o.kind === "content_not_approved") setView({ kind: "message", key: "therapy.player.content_pending" });
    else if (o.kind === "not_open_yet") setView({ kind: "message", key: "therapy.enrol.not_open" });
    else setView({ kind: "message", key: "therapy.player.error" });
  };

  const finish = async (s: SessionContent | CachedSession) => {
    let payload: Record<string, number> | null = null;
    if (s.checkpoint) {
      const parsed: Record<string, number> = {};
      for (const key of s.instruments) {
        const raw = scores[key];
        if (!raw || !/^\d{1,3}$/.test(raw)) { setScoreError(true); return; }
        parsed[key] = Number(raw);
      }
      payload = parsed;
    }
    if (payload && isTherapyProgrammeCode(programme.code) && validateScores(programme.code, ordinal, payload) !== null) { setScoreError(true); return; }
    setScoreError(false);
    setBusy(true);
    const r = await completeSession(enrolmentId, ordinal, payload);
    if (r.kind === "ok") setView({ kind: "done", text: r.programmeCompleted ? "therapy.player.programme_done" : "therapy.player.done", paused: r.pausedForReview });
    else if (r.kind === "not_active") setView({ kind: "message", key: "therapy.player.not_active" });
    else if (r.kind === "rejected") setSaveError(true);
    else {
      const queued = await enqueueCompletion(deviceStore, { userId, enrolmentId, ordinal, scores: payload, queuedAt: new Date().toISOString() });
      setView(queued ? { kind: "done", text: "therapy.player.saved_offline", paused: false } : { kind: "message", key: "therapy.player.finish_error" });
    }
    setBusy(false);
  };

  if (view.kind === "loading") return <ActivityIndicator />;
  if (view.kind === "message") return <><ErrorText>{t(view.key)}</ErrorText><SecondaryButton title={t("therapy.guidance.back")} onPress={onBack} /></>;
  if (view.kind === "stopped") return <Guidance route={view.route} taskFailed={view.taskFailed} onBack={onBack} />;
  if (view.kind === "done") {
    return (
      <Card style={{ gap: 8 }}>
        <Text accessibilityRole="alert" style={{ fontWeight: "600", color: colors.ink }}>{t(view.text)}</Text>
        {view.paused && <MutedText>{t("therapy.player.paused_review")}</MutedText>}
        <SecondaryButton title={t("therapy.guidance.back")} onPress={onBack} />
      </Card>
    );
  }
  if (view.kind === "recheck") {
    return (
      <Card style={{ gap: 10 }}>
        <Text style={{ fontSize: 15, fontWeight: "700", color: colors.ink }}>{t("therapy.player.recheck_title")}</Text>
        <MutedText>{t("therapy.player.recheck_intro")}</MutedText>
        <Questions questions={view.q.questions} label={t("therapy.player.start")} busy={busy} onSubmit={start} />
      </Card>
    );
  }
  const s = view.s;
  const total = "totalSessions" in s ? s.totalSessions : 0;
  return (
    <View style={{ gap: 12 }}>
      <Card style={{ gap: 8 }}>
        <MutedText>{s.programmeTitle} · {t("therapy.player.session_of", "en", { n: s.ordinal, total })}</MutedText>
        <Text style={{ fontSize: 15, fontWeight: "700", color: colors.ink }}>{s.title}</Text>
        {"draftContent" in s && s.draftContent && <MutedText>{t("therapy.programme.draft_notice")}</MutedText>}
        <MutedText>{t("therapy.player.audio_none")}</MutedText>
        <Text style={{ fontSize: 14, lineHeight: 21, color: colors.ink }}>{s.text}</Text>
      </Card>
      <Card style={{ gap: 6 }}>
        <MutedText>{t("therapy.diary.note")}</MutedText>
        <TextInput
          multiline
          maxLength={1000}
          value={diary}
          onChangeText={(v) => { setDiary(v); AsyncStorage.setItem(diaryKey(enrolmentId), v).catch(() => {}); }}
          style={{ borderWidth: 1, borderColor: colors.border, borderRadius: 8, padding: 8, minHeight: 70, color: colors.ink }}
        />
      </Card>
      {s.checkpoint && (
        <Card style={{ gap: 8 }}>
          <Text style={{ fontWeight: "700", color: colors.ink }}>{t("therapy.player.scores_title")}</Text>
          <MutedText>{t("therapy.player.scores_intro")}</MutedText>
          {s.instruments.map((key) => (
            <View key={key} style={{ gap: 4 }}>
              <Text style={{ fontSize: 13.5, color: colors.ink }}>{t(`therapy.instrument.${key}` as MessageKey)}</Text>
              <TextInput keyboardType="number-pad" value={scores[key] ?? ""} onChangeText={(v) => setScores((x) => ({ ...x, [key]: v.replace(/\D/g, "").slice(0, 3) }))}
                style={{ borderWidth: 1, borderColor: colors.border, borderRadius: 8, padding: 8, width: 90, color: colors.ink }} />
            </View>
          ))}
          {scoreError && <ErrorText>{t("therapy.player.scores_needed")}</ErrorText>}
        </Card>
      )}
      {view.offlineCopy ? (
        <MutedText>{t("therapy.player.read_only_copy")}</MutedText>
      ) : (
        <>
          {saveError && <ErrorText>{t("therapy.player.score_rejected")}</ErrorText>}
      <PrimaryButton title={t("therapy.player.finish")} onPress={() => finish(s)} loading={busy} />
          <SecondaryButton
            title={t("therapy.player.stop")}
            onPress={async () => {
              if (await stopEnrolment(enrolmentId)) {
                await clearCachedSession(deviceStore, enrolmentId, ordinal);
                AsyncStorage.removeItem(diaryKey(enrolmentId)).catch(() => {});
                setView({ kind: "message", key: "therapy.player.stopped" });
              } else setView({ kind: "message", key: "therapy.player.error" });
            }}
          />
        </>
      )}
      <Card style={{ gap: 6 }}>
        <Text style={{ fontWeight: "700", color: colors.ink }}>{t("therapy.share.title")}</Text>
        <MutedText>{t("therapy.share.body")}</MutedText>
        {shared !== null && <MutedText>{shared ? t("therapy.share.status_on") : t("therapy.share.status_off")}</MutedText>}
        <SecondaryButton title={shared ? t("therapy.share.off") : t("therapy.share.on")} onPress={async () => { if (await setSharing(enrolmentId, !shared)) setShared(!shared); }} disabled={shared === null} />
      </Card>
    </View>
  );
}

/**
 * Self-help programmes on the phone (S63). Everything sits inside the shared-phone gate (hidden on a shared phone, PIN, hide now), nothing
 * is sent to a notification, and a session opened once can be read again with no signal. The list shows only programmes whose go-live guard
 * is open, so a real patient sees the calm empty state while every guard is off.
 */
export function TherapyProgrammesScreen({ onBack }: { onBack: () => void }) {
  const colors = useLegacyColors();
  const { hidden, ready } = useSharedPhone();
  const [step, setStep] = useState<Step>({ kind: "list" });
  const [data, setData] = useState<{ programmes: ProgrammeRow[]; enrolments: EnrolmentRow[] } | null | "loading">("loading");

  const reload = useCallback(() => { setData("loading"); loadOpenProgrammes().then(setData); }, []);
  useEffect(() => { reload(); }, [reload]);
  const backToList = () => { setStep({ kind: "list" }); reload(); };

  return (
    <ScrollView style={{ flex: 1, backgroundColor: colors.background }} contentContainerStyle={{ padding: spacing.screen, gap: 16 }}>
      <View>
        <ScreenTitle>{t("therapy.title")}</ScreenTitle>
        <MutedText>{t("therapy.intro")}</MutedText>
      </View>
      <SharedPhoneSettings />
      {!ready ? <ActivityIndicator /> : hidden ? <HiddenCard /> : step.kind === "entry" ? (
        <Entry programme={step.programme} onBack={backToList} onEnrolled={backToList} />
      ) : step.kind === "player" ? (
        <Player programme={step.programme} enrolmentId={step.enrolmentId} ordinal={step.ordinal} onBack={backToList} />
      ) : data === "loading" ? <ActivityIndicator /> : data === null ? <ErrorText>{t("therapy.list_error")}</ErrorText> : data.programmes.length === 0 ? (
        <MutedText>{t("therapy.list_none")}</MutedText>
      ) : (
        data.programmes.map((p) => {
          const mine = data.enrolments.find((e) => e.programme_id === p.id && (e.state === "active" || e.state === "paused"));
          return (
            <Card key={p.id} style={{ gap: 6 }}>
              <Text style={{ fontSize: 15, fontWeight: "700", color: colors.ink }}>{p.title}</Text>
              <MutedText>{p.summary}</MutedText>
              {mine?.state === "paused" ? <MutedText>{t("therapy.player.paused_review")}</MutedText> : (
                <PrimaryButton
                  title={mine ? t("therapy.programme.continue") : t("therapy.programme.start")}
                  onPress={() => setStep(mine ? { kind: "player", programme: p, enrolmentId: mine.id, ordinal: mine.completed_count + 1 } : { kind: "entry", programme: p })}
                />
              )}
            </Card>
          );
        })
      )}
      <SecondaryButton title={t("therapy.guidance.back")} onPress={onBack} />
    </ScrollView>
  );
}
