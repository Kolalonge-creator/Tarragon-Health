import { useCallback, useEffect, useState } from "react";
import { Linking, Share, TextInput, View } from "react-native";
import { asLocale, t, type MessageKey } from "@tarragon/i18n";
import { buildNextStep, buildTrustLine } from "@tarragon/shared";
import { useUiLanguage } from "@/lib/ui-language";
import { getAudioService } from "@/lib/audio/service";
import {
  loadDailyLesson,
  loadItemTrust,
  loadLessonDetail,
  saveLessonForConsultation,
  searchLibrary,
  sharedArticleUrl,
  type DailyLesson,
  type ItemTrust,
  type SearchHit,
} from "@/lib/learning-centre";
import {
  isPackEnabled,
  pickOfflineDailyLesson,
  purgeExpired,
  readOffline,
  refreshPack,
  searchOffline,
  setPackEnabled,
  sqlitePackStore,
  type StoredLesson,
} from "@/lib/learning-pack";
import { markContentProgress, parseKnowledgeCheck, scoreKnowledgeCheck, statusFromCheck } from "@/lib/health-education";
import { radii, space, useTheme } from "@/ui/design";
import { AppText, Button, Card, InlineAlert, PressableScale } from "@/ui/kit";

function useTr() {
  const language = asLocale(useUiLanguage());
  return (key: MessageKey, params?: Record<string, string | number>) => t(key, language, params);
}

/**
 * The fixed template under every lesson on the phone: who reviewed it and when, the sources, the required
 * "What can I do next?" block and the urgent-help box. Mirrors the web LearningItemFooter. Only the self-care step is
 * authored; asking the care team and the urgent-help box are fixed copy. When the server cannot be reached, `fallback`
 * (a downloaded lesson) supplies the same facts.
 */
export function LessonFooter({ code, title, canShare, fallback }: { code: string; title: string; canShare: boolean; fallback?: StoredLesson | null }) {
  const tr = useTr();
  const { colors } = useTheme();
  const [trust, setTrust] = useState<ItemTrust | null>(null);
  const [saved, setSaved] = useState<"idle" | "done" | "failed">("idle");
  const [listenNote, setListenNote] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    loadItemTrust(code)
      .then((r) => alive && setTrust(r))
      .catch(() => alive && setTrust(null));
    return () => {
      alive = false;
    };
  }, [code]);

  const line = buildTrustLine({
    reviewedByName: trust?.reviewed_by_name ?? fallback?.reviewedByName,
    reviewedAt: trust?.reviewed_at ?? fallback?.reviewedAt,
    nextReviewDue: trust?.next_review_due ?? fallback?.nextReviewDue,
    sourceReference: trust?.source_reference ?? fallback?.sourceReference,
    evidenceSource: trust?.evidence_source,
    clinicalAuthorName: trust?.clinical_author_name,
    creatorName: trust?.creator_name ?? fallback?.creatorName,
  });
  const selfCare = trust?.self_care_action ?? fallback?.selfCareAction;
  const audioClip = trust?.audio_clip_id ?? fallback?.audioClipId ?? null;
  const shareable = canShare && (trust?.share_enabled ?? false);

  async function ask() {
    try {
      setSaved((await saveLessonForConsultation(code)) ? "done" : "failed");
    } catch {
      setSaved("failed");
    }
  }
  async function listen() {
    if (!audioClip) return;
    const spoken = await getAudioService().playClips([audioClip], "en");
    setListenNote(spoken.played ? null : tr("learn.audio.unavailable"));
  }
  const url = sharedArticleUrl(code);

  return (
    <View style={{ gap: space.md, borderTopWidth: 1, borderTopColor: colors.border, paddingTop: space.md }}>
      <View style={{ gap: 2 }}>
        {line.author ? <AppText variant="caption" tone="textMuted">{tr("learn.trust.author", { name: line.author })}</AppText> : null}
        {line.reviewedBy ? <AppText variant="caption" tone="textMuted">{tr("learn.trust.reviewed_by", { name: line.reviewedBy })}</AppText> : null}
        {line.reviewedOn ? <AppText variant="caption" tone="textMuted">{tr("learn.trust.reviewed_on", { date: line.reviewedOn })}</AppText> : null}
        {line.nextReview ? <AppText variant="caption" tone="textMuted">{tr("learn.trust.next_review", { date: line.nextReview })}</AppText> : null}
        {line.sources ? <AppText variant="caption" tone="textMuted">{tr("learn.trust.sources", { sources: line.sources })}</AppText> : null}
        {line.incomplete ? <AppText variant="caption" tone="textMuted">{tr("learn.trust.pending")}</AppText> : null}
      </View>

      {audioClip ? (
        <View style={{ gap: space.xs }}>
          <Button title={tr("learn.audio.listen")} variant="secondary" fullWidth={false} onPress={() => void listen()} />
          {listenNote ? <AppText variant="caption" tone="textMuted">{listenNote}</AppText> : null}
        </View>
      ) : null}

      <View style={{ gap: space.sm, backgroundColor: colors.brandTint, borderRadius: radii.md, padding: space.md }}>
        <AppText variant="bodyStrong" heading>{tr("learn.next.title")}</AppText>
        {buildNextStep(selfCare).map((a) =>
          a.kind === "self_care" ? (
            <AppText key={a.kind}>{`${tr("learn.next.self_care")}: ${a.text ?? ""}`}</AppText>
          ) : a.kind === "ask_care_team" ? (
            <View key={a.kind} style={{ gap: space.xs }}>
              <Button title={tr("learn.next.ask")} variant="secondary" disabled={saved === "done"} onPress={() => void ask()} />
              {saved === "done" ? <AppText variant="caption" tone="textMuted">{tr("learn.next.ask_done")}</AppText> : null}
              {saved === "failed" ? <AppText variant="caption" tone="dangerText">{tr("learn.next.ask_failed")}</AppText> : null}
            </View>
          ) : null,
        )}
      </View>

      <InlineAlert tone="warn" message={`${tr("learn.urgent.title")}. ${tr("learn.urgent.body")}`} />

      {shareable ? (
        <View style={{ flexDirection: "row", gap: space.md, flexWrap: "wrap" }}>
          <Button title={tr("learn.share.button")} variant="secondary" fullWidth={false} onPress={() => void Share.share({ message: `${title}\n${url}`, url })} />
          <Button
            title={tr("learn.share.email")}
            variant="ghost"
            fullWidth={false}
            onPress={() =>
              void Linking.openURL(
                `mailto:?subject=${encodeURIComponent(tr("learn.share.email_subject"))}&body=${encodeURIComponent(tr("learn.share.email_body", { title, url }))}`,
              )
            }
          />
        </View>
      ) : null}
    </View>
  );
}

/**
 * The daily micro-lesson (spec 9.2): under five minutes, one action, one check question. Reusable: the Learn screen and Home mount
 * it today, and the Today screen can mount the same component. Nothing is drawn when there is no in-date lesson. With no
 * signal it falls back to the first in-date downloaded micro-lesson, read-only.
 */
export function DailyLessonCard({ patientId, organisationId }: { patientId: string; organisationId: string }) {
  const tr = useTr();
  const [lesson, setLesson] = useState<DailyLesson | null>(null);
  const [offline, setOffline] = useState<StoredLesson | null>(null);
  const [loading, setLoading] = useState(true);
  const [open, setOpen] = useState(false);
  const [picked, setPicked] = useState<number | null>(null);
  const [result, setResult] = useState<"right" | "again" | "failed" | null>(null);

  const load = useCallback(async () => {
    try {
      setLesson(await loadDailyLesson());
      setOffline(null);
    } catch {
      setLesson(null);
      setOffline(pickOfflineDailyLesson(await readOffline(sqlitePackStore)));
    }
  }, []);

  useEffect(() => {
    void load().finally(() => setLoading(false));
  }, [load]);

  const source = lesson
    ? {
        id: lesson.content_id, code: lesson.code, title: lesson.title, body: lesson.body, minutes: lesson.estimated_minutes,
        action: lesson.lesson_action, check: lesson.check_question, doneToday: lesson.completed_today === true,
      }
    : offline
      ? {
          id: null, code: offline.code, title: offline.title, body: offline.body, minutes: offline.estimatedMinutes,
          action: offline.lessonAction, check: Array.isArray(offline.knowledgeCheck) ? (offline.knowledgeCheck[0] ?? null) : null, doneToday: false,
        }
      : null;
  if (loading || !source) return null;
  const question = parseKnowledgeCheck(source.check ? [source.check] : null)?.[0] ?? null;
  const done = source.doneToday || result === "right";

  async function submit() {
    if (!source?.id || !question || picked === null) return;
    const scored = scoreKnowledgeCheck([question], [picked]);
    const res = await markContentProgress(patientId, organisationId, {
      contentId: source.id,
      status: statusFromCheck(scored),
      checkScore: scored.score,
      checkTotal: scored.total,
    });
    if (!res.ok) {
      setResult("failed");
      return;
    }
    setResult(scored.allCorrect ? "right" : "again");
    await load();
  }

  return (
    <Card style={{ gap: space.sm }}>
      <AppText variant="caption" tone="brandText">{tr("learn.daily.title")}</AppText>
      <AppText variant="title" heading>{source.title}</AppText>
      {source.minutes ? <AppText variant="caption" tone="textMuted">{tr("learn.daily.minutes", { minutes: source.minutes })}</AppText> : null}
      {done ? (
        <AppText>{tr("learn.daily.done")}</AppText>
      ) : !open ? (
        <Button title={tr("learn.daily.start")} onPress={() => setOpen(true)} />
      ) : (
        <View style={{ gap: space.sm }}>
          <AppText>{source.body}</AppText>
          {source.action ? <AppText variant="bodyStrong">{`${tr("learn.daily.action_label")}: ${source.action}`}</AppText> : null}
          {question ? (
            <View style={{ gap: space.xs }}>
              <AppText variant="bodyStrong">{tr("learn.daily.check_label")}</AppText>
              <AppText>{question.question}</AppText>
              {question.options.map((opt, i) => (
                <PressableScale
                  key={i}
                  accessibilityRole="radio"
                  accessibilityState={{ selected: picked === i }}
                  accessibilityLabel={opt}
                  onPress={() => (result === null ? setPicked(i) : undefined)}
                  style={{ minHeight: 44, justifyContent: "center", paddingHorizontal: space.md }}
                >
                  <AppText tone={picked === i ? "brandText" : "text"}>{`${picked === i ? "(x) " : "( ) "}${opt}`}</AppText>
                </PressableScale>
              ))}
              {result === null && source.id ? <Button title={tr("common.continue")} disabled={picked === null} onPress={() => void submit()} /> : null}
              {result === "again" ? <AppText variant="caption" tone="textMuted">{tr("learn.daily.again")}</AppText> : null}
              {result === "failed" ? <AppText variant="caption" tone="dangerText">{tr("learn.daily.save_failed")}</AppText> : null}
            </View>
          ) : null}
          <LessonFooter code={source.code} title={source.title} canShare fallback={offline} />
        </View>
      )}
    </Card>
  );
}

/** Search in everyday words. Online it asks the server (synonym table, zero-result log); with no signal it searches the downloads. */
export function LearnSearchCard({ onOpen }: { onOpen: (code: string) => void }) {
  const tr = useTr();
  const { colors } = useTheme();
  const [raw, setRaw] = useState("");
  const [hits, setHits] = useState<{ code: string; title: string; summary: string | null }[] | null>(null);

  useEffect(() => {
    const q = raw.trim();
    if (q.length < 2) {
      setHits(null);
      return;
    }
    let alive = true;
    const id = setTimeout(() => {
      searchLibrary(q)
        .then((r: SearchHit[]) => alive && setHits(r.map((h) => ({ code: h.code, title: h.title, summary: h.summary }))))
        .catch(async () => {
          const local = searchOffline(await readOffline(sqlitePackStore), q);
          if (alive) setHits(local.map((l) => ({ code: l.code, title: l.title, summary: l.summary })));
        });
    }, 350);
    return () => {
      alive = false;
      clearTimeout(id);
    };
  }, [raw]);

  return (
    <Card style={{ gap: space.sm }}>
      <AppText variant="title" heading>{tr("learn.search.title")}</AppText>
      <TextInput
        value={raw}
        onChangeText={setRaw}
        placeholder={tr("learn.search.placeholder")}
        placeholderTextColor={colors.textSubtle}
        accessibilityLabel={tr("learn.search.title")}
        maxLength={80}
        style={{ minHeight: 48, borderWidth: 1, borderColor: colors.border, borderRadius: radii.md, paddingHorizontal: space.md, color: colors.text }}
      />
      {hits && hits.length === 0 ? <AppText tone="textMuted">{tr("learn.search.none")}</AppText> : null}
      {hits?.map((h) => (
        <PressableScale key={h.code} accessibilityRole="button" accessibilityLabel={h.title} onPress={() => onOpen(h.code)} style={{ minHeight: 44, justifyContent: "center" }}>
          <AppText variant="bodyStrong">{h.title}</AppText>
          {h.summary ? <AppText variant="caption" tone="textMuted">{h.summary}</AppText> : null}
        </PressableScale>
      ))}
    </Card>
  );
}

/** Offline downloads (spec 9.6): opt in, refresh on return to the app, remove. Lessons past their review date are never shown. */
export function DownloadsCard({ onOpen }: { onOpen: (code: string) => void }) {
  const tr = useTr();
  const [enabled, setEnabled] = useState(false);
  const [items, setItems] = useState<StoredLesson[]>([]);
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);

  const reload = useCallback(async () => {
    await purgeExpired(sqlitePackStore);
    setItems(await readOffline(sqlitePackStore));
  }, []);

  useEffect(() => {
    void isPackEnabled().then(setEnabled);
    void reload();
  }, [reload]);

  async function download() {
    setBusy(true);
    setFailed(false);
    await setPackEnabled(true);
    setEnabled(true);
    const res = await refreshPack({ store: sqlitePackStore });
    setFailed(!res.ok);
    await reload();
    setBusy(false);
  }
  async function remove() {
    await setPackEnabled(false);
    setEnabled(false);
    setItems([]);
  }
  const bytes = items.reduce((n, l) => n + l.textBytes, 0);

  return (
    <Card style={{ gap: space.sm }}>
      <AppText variant="title" heading>{tr("learn.offline.title")}</AppText>
      <AppText tone="textMuted">{tr("learn.offline.body")}</AppText>
      <AppText variant="caption" tone="textMuted">{tr("learn.offline.wifi_note")}</AppText>
      <AppText variant="caption" tone="textMuted">{tr("learn.offline.expired_hidden")}</AppText>
      {items.length > 0 ? <AppText>{tr("learn.offline.summary", { count: items.length, size: (bytes / 1_000_000).toFixed(1) })}</AppText> : null}
      {failed ? <InlineAlert tone="info" message={tr("learn.offline.failed")} /> : null}
      <Button title={busy ? tr("learn.offline.downloading") : tr("learn.offline.download")} variant="secondary" loading={busy} onPress={() => void download()} />
      {enabled ? <Button title={tr("learn.offline.remove")} variant="ghost" onPress={() => void remove()} /> : null}
      {items.slice(0, 8).map((l) => (
        <PressableScale key={l.code} accessibilityRole="button" accessibilityLabel={l.title} onPress={() => onOpen(l.code)} style={{ minHeight: 44, justifyContent: "center" }}>
          <AppText>{l.title}</AppText>
        </PressableScale>
      ))}
    </Card>
  );
}

/** A lesson opened from search or downloads: from the server when reachable, from the downloads otherwise. Never an expired one. */
export function LessonViewer({ code, onClose }: { code: string; onClose: () => void }) {
  const tr = useTr();
  const [view, setView] = useState<{ title: string; body: string; article: boolean; fallback: StoredLesson | null } | null | "gone">(null);

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const d = await loadLessonDetail(code);
        if (alive) setView(d ? { title: d.title, body: d.body, article: d.content_type === "article", fallback: null } : "gone");
      } catch {
        const saved = (await readOffline(sqlitePackStore)).find((l) => l.code === code);
        if (alive) setView(saved ? { title: saved.title, body: saved.body, article: true, fallback: saved } : "gone");
      }
    })();
    return () => {
      alive = false;
    };
  }, [code]);

  if (view === null) return null;
  return (
    <Card style={{ gap: space.sm }}>
      <Button title={tr("common.cancel")} variant="ghost" fullWidth={false} onPress={onClose} />
      {view === "gone" ? (
        <AppText tone="textMuted">{tr("learn.share.notfound_body")}</AppText>
      ) : (
        <>
          <AppText variant="title" heading>{view.title}</AppText>
          <AppText>{view.body}</AppText>
          <LessonFooter code={code} title={view.title} canShare={view.article} fallback={view.fallback} />
        </>
      )}
    </Card>
  );
}
