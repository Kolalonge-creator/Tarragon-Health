"use client";

import { useEffect, useRef, useState } from "react";
import { t, type Locale } from "@tarragon/i18n";
import {
  useMyWrittenQuestions,
  usePostWrittenQuestionMessage,
  useSendWrittenQuestion,
  useWrittenQuestionAllowance,
} from "@/lib/queries/written-questions";
import { clearDraft, loadDraft, newClientId, saveDraft, type WrittenQuestionDraft } from "@/lib/written-questions/draft";
import { mapWrittenQuestionError, type MappedError } from "@/lib/written-questions/errors";
import { checkPhoto, compressPhoto } from "@/lib/written-questions/photos";
import { viewWrittenQuestion } from "@/lib/written-questions/status";
import {
  QUESTION_MIN_LENGTH,
  WRITTEN_QUESTION_CATEGORIES,
  type WrittenQuestion,
  type WrittenQuestionAllowance,
  type WrittenQuestionCategory,
} from "@/lib/written-questions/types";
import { formatPatientDate, formatPatientDateTime } from "@/lib/format-date";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { FormError, FormSuccess, fieldErrorId, fieldErrorProps } from "@/components/ui/form-error";

const MUTED = "text-charcoal-ink/70 dark:text-night-ink/70";
const TOUCH = "min-h-11";

function isCategory(v: string): v is WrittenQuestionCategory {
  return (WRITTEN_QUESTION_CATEGORIES as readonly string[]).includes(v);
}

function ReplyBox({ consultId, locale }: { consultId: string; locale: Locale }) {
  const post = usePostWrittenQuestionMessage();
  const [body, setBody] = useState("");
  const [error, setError] = useState<MappedError | null>(null);
  const id = `wq-reply-${consultId}`;
  const errId = fieldErrorId(id);

  async function send() {
    setError(null);
    if (body.trim().length === 0) return;
    try {
      await post.mutateAsync({ consultId, body: body.trim() });
      setBody("");
    } catch (e) {
      setError(mapWrittenQuestionError(e instanceof Error ? e.message : null));
    }
  }

  return (
    <div className="space-y-2">
      <Label htmlFor={id}>{t("wq.thread.reply.label", locale)}</Label>
      <Textarea id={id} rows={3} value={body} onChange={(e) => setBody(e.target.value)} {...fieldErrorProps(errId, Boolean(error))} />
      <FormError id={errId} message={error ? t(error.key, locale, error.params) : null} />
      <Button size="sm" className={TOUCH} onClick={send} disabled={post.isPending || body.trim().length === 0}>
        {t("wq.thread.reply.send", locale)}
      </Button>
    </div>
  );
}

function QuestionRow({ q, locale }: { q: WrittenQuestion; locale: Locale }) {
  const view = viewWrittenQuestion(q, new Date());
  const messages = q.messages ?? [];
  return (
    <li className="space-y-2 py-3">
      <div className="flex flex-wrap items-center gap-2">
        <p className="text-sm font-medium text-charcoal-ink dark:text-night-ink">{q.question}</p>
        <Badge variant={view.stage === "answered" ? "green" : "blue"}>{t(view.labelKey, locale)}</Badge>
      </div>
      {view.stage === "waiting" && q.window_due_at && (
        <p className={`text-xs ${MUTED}`}>
          {t("wq.window", locale, { hours: Math.max(1, Math.round((new Date(q.window_due_at).getTime() - new Date(q.created_at).getTime()) / 3600000)) })}
          {` (${formatPatientDateTime(q.window_due_at)})`}
        </p>
      )}
      {view.missed && <p className={`text-xs ${MUTED}`}>{t("wq.status.missed", locale)}</p>}
      {view.stage === "call" && <p className={`text-sm ${MUTED}`}>{t("wq.call.note", locale)}</p>}
      {view.showAnswer && q.answer && (
        <div className="rounded-lg border border-brand-green/20 bg-brand-green/[0.04] p-3">
          {/* No name is shown: this RPC carries no reviewer attribution, and none is invented. */}
          <p className="whitespace-pre-line text-sm text-charcoal-ink dark:text-night-ink">{q.answer}</p>
        </div>
      )}
      {messages.length > 0 && (
        <ul className="space-y-2" aria-label={t("wq.title", locale)}>
          {messages.map((m) => (
            <li
              key={m.id}
              className={`rounded-md p-2 text-sm ${m.author_role === "patient" ? "bg-charcoal-ink/5 dark:bg-night-ink/10" : "border border-brand-green/20"}`}
            >
              <p className="whitespace-pre-line">{m.body}</p>
              <p className={`text-xs ${MUTED}`}>{formatPatientDateTime(m.created_at)}</p>
            </li>
          ))}
        </ul>
      )}
      {view.followUpOpen && q.follow_up_until && (
        <p className={`text-xs ${MUTED}`}>{t("wq.followup.until", locale, { date: formatPatientDate(q.follow_up_until) })}</p>
      )}
      {view.followUpEnded && <p className={`text-xs ${MUTED}`}>{t("wq.followup.ended", locale)}</p>}
      {view.canReply && <ReplyBox consultId={q.id} locale={locale} />}
    </li>
  );
}

interface PickedPhoto {
  id: string;
  blob: Blob;
  url: string;
}

function QuestionForm({ patientId, locale, allowance }: { patientId: string; locale: Locale; allowance: WrittenQuestionAllowance }) {
  const send = useSendWrittenQuestion();
  // Client-only: this form mounts after the allowance query resolves, so reading localStorage here cannot mismatch SSR.
  const [initialDraft] = useState(() => loadDraft(patientId));
  const [fields, setFields] = useState<WrittenQuestionDraft>(() => ({
    category: initialDraft && isCategory(initialDraft.category) ? initialDraft.category : "general",
    question: initialDraft?.question ?? "",
    duration: initialDraft?.duration ?? "",
    clientId: initialDraft?.clientId ?? newClientId(),
  }));
  const [draftSaved, setDraftSaved] = useState(() => initialDraft !== null);
  const category: WrittenQuestionCategory = isCategory(fields.category) ? fields.category : "general";
  const { question, duration } = fields;

  function update(next: Partial<WrittenQuestionDraft>) {
    const merged = { ...fields, ...next };
    setFields(merged);
    setDraftSaved(saveDraft(patientId, merged));
  }
  const [photos, setPhotos] = useState<PickedPhoto[]>([]);
  const [error, setError] = useState<MappedError | null>(null);
  const [photoError, setPhotoError] = useState<string | null>(null);
  const [redFlag, setRedFlag] = useState(false);
  const [sent, setSent] = useState(false);
  const photoUrls = useRef<string[]>([]);

  useEffect(() => {
    const urls = photoUrls.current;
    return () => urls.forEach((u) => URL.revokeObjectURL(u));
  }, []);

  const canSend = allowance.remaining > 0 || allowance.has_credit;
  const questionErrId = fieldErrorId("wq-question");

  async function addPhotos(files: FileList | null) {
    setPhotoError(null);
    if (!files) return;
    let count = photos.length;
    const added: PickedPhoto[] = [];
    for (const file of Array.from(files)) {
      const check = checkPhoto(file, count, { maxPhotos: allowance.max_photos, maxBytes: Number.MAX_SAFE_INTEGER });
      if (!check.ok) {
        setPhotoError(t(check.reason === "limit" ? "wq.photos.limit" : "wq.error.photo_rejected", locale, { max: allowance.max_photos }));
        break;
      }
      try {
        const blob = await compressPhoto(file);
        if (blob.size > allowance.max_photo_bytes) {
          setPhotoError(t("wq.error.photo_rejected", locale));
          continue;
        }
        const url = URL.createObjectURL(blob);
        photoUrls.current.push(url);
        added.push({ id: crypto.randomUUID(), blob, url });
        count += 1;
      } catch {
        setPhotoError(t("wq.error.photo_rejected", locale));
      }
    }
    if (added.length) setPhotos((p) => [...p, ...added]);
  }

  async function submit(acknowledged: boolean) {
    setError(null);
    setSent(false);
    const outcome = await send.mutateAsync({
      category,
      question,
      durationNote: duration,
      clientId: fields.clientId,
      photos: photos.map((p) => ({ id: p.id, blob: p.blob })),
      redFlagAcknowledged: acknowledged,
    });
    if (outcome.kind === "red_flag") {
      setRedFlag(true);
      return;
    }
    setRedFlag(false);
    if (outcome.kind === "invalid" || outcome.kind === "error") {
      setError(outcome.error);
      return;
    }
    clearDraft(patientId);
    // A sent question's id is spent; the next question gets its own.
    setFields({ category, question: "", duration: "", clientId: newClientId() });
    setDraftSaved(false);
    setPhotos([]);
    setSent(true);
    if (outcome.photoFailures > 0) setPhotoError(t("wq.error.photo_later", locale));
  }

  if (redFlag) {
    return (
      <div role="alertdialog" aria-labelledby="wq-red-title" aria-describedby="wq-red-body" className="space-y-3 rounded-md border border-red-300 bg-red-50 p-4 dark:border-red-400/40 dark:bg-red-950/30">
        <h3 id="wq-red-title" className="text-base font-semibold text-red-800 dark:text-red-200">{t("wq.red_flag.title", locale)}</h3>
        <p id="wq-red-body" className="text-sm text-red-900 dark:text-red-100">{t("wq.red_flag.body", locale)}</p>
        <div className="flex flex-wrap gap-2">
          <Button className={TOUCH} onClick={() => setRedFlag(false)}>{t("wq.red_flag.back", locale)}</Button>
          <Button className={TOUCH} variant="outline" onClick={() => submit(true)} disabled={send.isPending}>
            {t("wq.red_flag.dismiss", locale)}
          </Button>
        </div>
      </div>
    );
  }

  return (
    <form
      className="space-y-4"
      onSubmit={(e) => {
        e.preventDefault();
        void submit(false);
      }}
    >
      <div className="space-y-2">
        <Label htmlFor="wq-category">{t("wq.category.label", locale)}</Label>
        <Select id="wq-category" value={category} onChange={(e) => update({ category: e.target.value })} disabled={!canSend}>
          {WRITTEN_QUESTION_CATEGORIES.map((c) => (
            <option key={c} value={c}>{t(`wq.category.${c}`, locale)}</option>
          ))}
        </Select>
      </div>
      <div className="space-y-2">
        <Label htmlFor="wq-question">{t("wq.question.label", locale)}</Label>
        <Textarea
          id="wq-question"
          rows={4}
          value={question}
          onChange={(e) => update({ question: e.target.value })}
          placeholder={t("wq.question.placeholder", locale)}
          disabled={!canSend}
          aria-describedby={`wq-question-help ${error ? questionErrId : ""}`.trim()}
          aria-invalid={error ? true : undefined}
        />
        <p id="wq-question-help" className={`text-xs ${MUTED}`}>{t("wq.question.help", locale, { min: QUESTION_MIN_LENGTH })}</p>
        <FormError id={questionErrId} message={error ? t(error.key, locale, error.params) : null} />
      </div>
      <div className="space-y-2">
        <Label htmlFor="wq-duration">{t("wq.duration.label", locale)}</Label>
        <input
          id="wq-duration"
          type="text"
          value={duration}
          onChange={(e) => update({ duration: e.target.value })}
          maxLength={200}
          disabled={!canSend}
          className={`${TOUCH} w-full rounded-md border border-charcoal-ink/20 bg-transparent px-3 text-sm dark:border-night-ink/25`}
        />
      </div>
      <div className="space-y-2">
        <p className="text-sm font-medium text-charcoal-ink dark:text-night-ink">{t("wq.photos.title", locale)}</p>
        <p className={`text-xs ${MUTED}`}>{t("wq.photos.guidance", locale)}</p>
        {photos.length > 0 && (
          <ul className="flex flex-wrap gap-3">
            {photos.map((p) => (
              <li key={p.id} className="space-y-1">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={p.url} alt="" className="h-20 w-20 rounded-md object-cover" />
                <Button type="button" size="sm" variant="outline" className={TOUCH} onClick={() => setPhotos((all) => all.filter((x) => x.id !== p.id))}>
                  {t("wq.photos.remove", locale)}
                </Button>
              </li>
            ))}
          </ul>
        )}
        {photos.length < allowance.max_photos && (
          <label className={`${TOUCH} inline-flex cursor-pointer items-center rounded-md border border-charcoal-ink/20 px-4 text-sm focus-within:ring-2 dark:border-night-ink/25`}>
            {t("wq.photos.add", locale)}
            <input
              type="file"
              accept="image/jpeg,image/png,image/webp,image/heic,image/heif"
              multiple
              className="sr-only"
              disabled={!canSend}
              onChange={(e) => {
                void addPhotos(e.target.files);
                e.target.value = "";
              }}
            />
          </label>
        )}
        <FormError id={fieldErrorId("wq-photos")} message={photoError} />
      </div>
      {draftSaved && <p className={`text-xs ${MUTED}`}>{t("wq.draft.saved", locale)}</p>}
      <FormSuccess message={sent && t("wq.sent", locale)} />
      <Button type="submit" className={TOUCH} disabled={send.isPending || !canSend}>
        {send.isPending ? t("wq.sending", locale) : t("wq.send", locale)}
      </Button>
    </form>
  );
}

/**
 * Written questions to the care team (S22). Members only, with a published reply window and a monthly allowance. Never
 * shows a price or a balance (INV-09). The deterministic red-flag screen runs before anything is sent (INV-01).
 */
export function WrittenQuestionCard({ patientId, locale }: { patientId: string; locale: Locale }) {
  const allowanceQuery = useWrittenQuestionAllowance();
  const questionsQuery = useMyWrittenQuestions();
  const allowance = allowanceQuery.data ?? null;
  const questions = questionsQuery.data ?? [];

  const canAsk = allowance !== null && (allowance.is_member || allowance.has_credit);
  const hours = allowance ? Math.round(allowance.window_minutes / 60) : 24;

  return (
    <Card id="ask-a-doctor">
      <CardHeader>
        <CardTitle>{t("wq.title", locale)}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {allowanceQuery.isLoading ? null : !canAsk || allowance === null ? (
          <p className="text-sm text-charcoal-ink dark:text-night-ink">{t("wq.members_only", locale)}</p>
        ) : (
          <>
            <p className={`text-sm ${MUTED}`}>{t("wq.intro", locale, { hours })}</p>
            <p className="text-sm font-medium text-charcoal-ink dark:text-night-ink">
              {allowance.remaining > 0
                ? t("wq.allowance.left", locale, { left: allowance.remaining, total: allowance.allowance })
                : t("wq.allowance.none", locale)}
            </p>
            <p className={`text-xs ${MUTED}`}>{t("wq.window", locale, { hours })}</p>
            <QuestionForm patientId={patientId} locale={locale} allowance={allowance} />
          </>
        )}
        {questions.length > 0 ? (
          <ul className="divide-y divide-charcoal-ink/10 border-t border-charcoal-ink/10 dark:divide-night-ink/15 dark:border-night-ink/15">
            {questions.map((q) => (
              <QuestionRow key={q.id} q={q} locale={locale} />
            ))}
          </ul>
        ) : (
          canAsk && !questionsQuery.isLoading && <p className={`text-sm ${MUTED}`}>{t("wq.empty", locale)}</p>
        )}
      </CardContent>
    </Card>
  );
}
