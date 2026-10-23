"use client";

import { useEffect, useId, useMemo, useRef, useState } from "react";
import { DEFAULT_LOCALE, t, type MessageKey } from "@tarragon/i18n";
import {
  DIARY_GLUCOSE_CONTEXTS,
  HELD_READING_COPY,
  applySaveAnswer,
  isBlankRow,
  summarise,
  type RowFeedback,
  type SaveAnswer,
  diaryLimits,
  diaryTodayLagos,
  emptyDiaryRow,
  validateDiaryRow,
  type DiaryDraftRow,
  type DiaryKind,
  type DiaryProblem,
} from "@tarragon/shared";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { useOnlineStatus } from "@/lib/network/use-online-status";
import { vitalSavedMessage } from "@/lib/vitals/bp-ack-message";
import { saveDiaryAction } from "./actions";

const newKey = (): string => crypto.randomUUID();
const LIMITS = diaryLimits();

type ReaderState = "idle" | "reading";
type Banner = { tone: "info" | "error" | "success"; text: string } | null;

function problemText(p: DiaryProblem): string {
  return t(`diary.problem.${p}` as MessageKey, DEFAULT_LOCALE, { days: LIMITS.windowDays });
}

/**
 * The paper diary sheet (S07y). The person adds rows, or (when the reading assistant is open) a photo suggests rows; every row is theirs to edit, and nothing is
 * saved until they save the rows they checked. A suggested row starts UNCHECKED and is never saved until they tick that it matches their diary. Rows that cannot
 * be saved say why, in words, beside the row; rows that were saved leave the sheet; a failed save keeps everything.
 */
export function DiarySheet({ readerOpen }: { readerOpen: boolean }) {
  const [rows, setRows] = useState<DiaryDraftRow[]>(() => [emptyDiaryRow(newKey())]);
  const [feedback, setFeedback] = useState<Record<string, RowFeedback>>({});
  const [touched, setTouched] = useState<Record<string, boolean>>({});
  const [saving, setSaving] = useState(false);
  const [reader, setReader] = useState<ReaderState>("idle");
  const [banner, setBanner] = useState<Banner>(null);
  const [savedNote, setSavedNote] = useState<string | null>(null);
  const [photoUrl, setPhotoUrl] = useState<string | null>(null);
  const isOnline = useOnlineStatus();
  // DOM ids come from useId, never from a row's random key: the first row's key is made on the server AND again in the browser, so using it in an id would
  // make the server HTML and the first browser render disagree (a hydration mismatch).
  const baseId = useId();
  const fileRef = useRef<HTMLInputElement>(null);
  const [nowMs, setNowMs] = useState(() => Date.now());

  // keep "now" fresh so a row's date check does not go stale on a page left open
  useEffect(() => {
    const id = setInterval(() => setNowMs(Date.now()), 60_000);
    return () => clearInterval(id);
  }, []);
  // the preview of the person's own photo lives only in this page; it is released when it is replaced or the page is left
  useEffect(() => {
    return () => {
      if (photoUrl) URL.revokeObjectURL(photoUrl);
    };
  }, [photoUrl]);

  const summary = useMemo(() => summarise(rows, nowMs), [rows, nowMs]);
  const today = diaryTodayLagos(nowMs);
  const earliest = diaryTodayLagos(nowMs - LIMITS.windowDays * 86_400_000);

  function update(key: string, patch: Partial<DiaryDraftRow>) {
    setRows((current) =>
      current.map((r) => {
        if (r.key !== key) return r;
        const next = { ...r, ...patch };
        // editing a suggested row means the person has to check it again
        if (r.suggested && !("confirmed" in patch)) next.confirmed = false;
        return next;
      })
    );
    setTouched((c) => ({ ...c, [key]: true }));
    setFeedback((c) => {
      if (!(key in c)) return c;
      const { [key]: _gone, ...rest } = c;
      void _gone;
      return rest;
    });
    setSavedNote(null);
  }

  function addRow(kind: DiaryKind) {
    setRows((current) => [...current, emptyDiaryRow(newKey(), kind)]);
  }

  function removeRow(key: string) {
    setRows((current) => {
      const next = current.filter((r) => r.key !== key);
      return next.length === 0 ? [emptyDiaryRow(newKey())] : next;
    });
  }

  async function onPhoto(file: File | undefined) {
    if (!file) return;
    setBanner(null);
    if (!file.type.startsWith("image/")) {
      setBanner({ tone: "error", text: t("diary.photo.not_image") });
      return;
    }
    if (file.size > LIMITS.maxPhotoBytes) {
      setBanner({ tone: "error", text: t("diary.photo.too_big") });
      return;
    }
    setReader("reading");
    setPhotoUrl(URL.createObjectURL(file));
    try {
      const form = new FormData();
      form.set("file", file);
      const res = await fetch("/api/patient/diary/read", { method: "POST", body: form });
      const body = (await res.json().catch(() => null)) as
        | { status: "suggested"; rows: DiaryDraftRow[]; skipped: number }
        | { status: "unreadable" }
        | { status: "unavailable" }
        | { status: "not_open" }
        | { status: "rate_limited" }
        | { status: "bad_file"; reason: "too_big" | "not_image" | "missing" }
        | null;
      if (!body) setBanner({ tone: "error", text: t("diary.photo.failed") });
      else if (body.status === "suggested") {
        setRows((current) => {
          // a row the person has typed anything into is kept; only a wholly blank one is replaced by the suggestions
          const kept = current.filter((r) => !isBlankRow(r));
          return [...kept, ...body.rows];
        });
        setBanner({
          tone: "info",
          text: body.skipped > 0
            ? `${t("diary.photo.found", DEFAULT_LOCALE, { count: body.rows.length })} ${t("diary.photo.skipped", DEFAULT_LOCALE, { count: LIMITS.maxRows })}`
            : t("diary.photo.found", DEFAULT_LOCALE, { count: body.rows.length }),
        });
      } else if (body.status === "unreadable") setBanner({ tone: "info", text: t("diary.photo.unreadable") });
      else if (body.status === "bad_file") setBanner({ tone: "error", text: body.reason === "too_big" ? t("diary.photo.too_big") : t("diary.photo.not_image") });
      else if (body.status === "not_open") setBanner({ tone: "info", text: t("diary.photo.not_open") });
      else if (body.status === "rate_limited") setBanner({ tone: "info", text: t("diary.photo.rate_limited") });
      else setBanner({ tone: "info", text: t("diary.photo.unavailable") });
    } catch {
      setBanner({ tone: "error", text: t("diary.photo.failed") });
    } finally {
      setReader("idle");
      if (fileRef.current) fileRef.current.value = "";
    }
  }

  async function save() {
    if (saving || summary.ready.length === 0 || summary.tooMany) return;
    if (!isOnline) {
      setBanner({ tone: "error", text: t("diary.offline") });
      return;
    }
    setSaving(true);
    setBanner(null);
    setSavedNote(null);
    // every row of this call has its own id, so pressing Save twice, or retrying after a dropped connection, never doubles a reading
    const sent = summary.ready;
    const sentKeys = new Set(sent.map((r) => r.key));
    const result = await saveDiaryAction(sent);
    setSaving(false);
    if (result.status === "failed" || result.status === "invalid") {
      setBanner({ tone: "error", text: t("diary.save_failed") });
      return;
    }
    if (result.status === "not_open") {
      setBanner({ tone: "info", text: t("diary.not_open_save") });
      return;
    }
    if (result.tooMany) {
      setBanner({ tone: "error", text: t("diary.too_many", DEFAULT_LOCALE, { max: LIMITS.maxRows }) });
      return;
    }
    const applied = applySaveAnswer(rows, sentKeys, result as SaveAnswer);
    // Only the rows the server says are in the record leave the sheet; everything else is whatever the person has now (they may have edited, added or removed a
    // row while the save was in flight: replacing the sheet with the snapshot taken when Save was pressed would undo that).
    const gone = new Set(rows.filter((r) => !applied.rows.some((a) => a.key === r.key)).map((r) => r.key));
    setRows((cur) => {
      const next = cur.filter((r) => !gone.has(r.key));
      return next.length === 0 ? [emptyDiaryRow(newKey())] : next;
    });
    setFeedback(applied.feedback);
    // The same wording a typed reading gets, from the same signed source: a high or crisis-range value is told what to do, and a check that did not
    // finish is said in words, never as a plain "saved".
    const ack = result.bpAckLevel ? ` ${vitalSavedMessage(result.bpAckLevel)}` : "";
    const matched = applied.matched > 0 ? ` ${t("diary.matched", DEFAULT_LOCALE, { count: applied.matched })}` : "";
    if (result.safetyAssessmentFailed) {
      setSavedNote(`${t("diary.saved", DEFAULT_LOCALE, { count: applied.saved })} ${t("diary.safety_unfinished")}${matched}`);
    } else if (applied.saved > 0) {
      setSavedNote(
        applied.notSaved > 0
          ? `${t("diary.saved_partial", DEFAULT_LOCALE, { saved: applied.saved, failed: applied.notSaved })}${matched}`
          : `${t("diary.saved", DEFAULT_LOCALE, { count: applied.saved })}${ack}${matched}`
      );
    } else if (applied.matched > 0 && applied.notSaved === 0) {
      setSavedNote(t("diary.matched", DEFAULT_LOCALE, { count: applied.matched }));
    } else if (applied.notSaved > 0) {
      setBanner({ tone: "error", text: t("diary.save_failed") });
    }
  }

  const canSave = summary.ready.length > 0 && !summary.tooMany && !saving && isOnline;

  return (
    <div className="space-y-4">
      {readerOpen ? (
        <Card>
          <CardContent className="space-y-3 pt-6">
            <div className="flex flex-wrap items-center gap-3">
              <input ref={fileRef} id="diary-photo" type="file" accept="image/*" capture="environment" className="sr-only" onChange={(e) => void onPhoto(e.target.files?.[0])} />
              <Button type="button" variant="outline" disabled={reader === "reading" || !isOnline} onClick={() => fileRef.current?.click()}>
                {reader === "reading" ? t("diary.photo.reading") : t("diary.photo.button")}
              </Button>
              <p className="text-xs text-charcoal-ink/60 dark:text-night-ink/60">{t("diary.photo.hint")}</p>
            </div>
            {photoUrl && photoUrl.startsWith("blob:") && (
              // the person's own photo, kept only in this page, so each suggested row can be checked against it
              // eslint-disable-next-line @next/next/no-img-element
              <img src={photoUrl} alt="Your diary page" className="max-h-72 w-auto rounded-md border border-charcoal-ink/10" />
            )}
          </CardContent>
        </Card>
      ) : (
        <p className="text-sm text-charcoal-ink/60 dark:text-night-ink/60" data-testid="diary-photo-closed">
          {t("diary.photo.not_open")}
        </p>
      )}

      {banner && (
        <p
          role={banner.tone === "error" ? "alert" : "status"}
          className={
            banner.tone === "error"
              ? "rounded-md border border-red-300 bg-red-50 p-3 text-sm text-red-800 dark:border-red-500/40 dark:bg-red-500/15 dark:text-red-200"
              : "rounded-md border border-charcoal-ink/10 bg-charcoal-ink/5 p-3 text-sm dark:border-night-ink/15 dark:bg-night-ink/10"
          }
        >
          {banner.text}
        </p>
      )}

      <p className="text-xs text-charcoal-ink/60 dark:text-night-ink/60">{t("diary.window_note", DEFAULT_LOCALE, { days: LIMITS.windowDays })}</p>

      <ol className="space-y-3">
        {rows.map((row, index) => {
          const v = validateDiaryRow(row, nowMs, LIMITS);
          const problems = !v.ok ? v.problems.filter((p) => p !== "not_confirmed") : [];
          const fb = feedback[row.key];
          const showProblems = (touched[row.key] || row.suggested) && problems.length > 0;
          const rowId = `${baseId}-row-${index}`;
          return (
            <li key={row.key}>
              <Card>
                <CardContent className="space-y-3 pt-6">
                  <div className="flex items-center justify-between gap-2">
                    <p className="text-sm font-medium text-charcoal-ink dark:text-night-ink">
                      {t("diary.row.number", DEFAULT_LOCALE, { n: index + 1 })} · {t(`diary.kind.${row.kind}` as MessageKey)}
                    </p>
                    <Button type="button" size="sm" variant="outline" onClick={() => removeRow(row.key)}>
                      {t("diary.row.remove")}
                    </Button>
                  </div>
                  {row.suggested && <p className="text-xs text-charcoal-ink/60 dark:text-night-ink/60">{t("diary.photo.suggested")}</p>}
                  <div className="grid grid-cols-2 items-end gap-3 sm:grid-cols-4">
                    <div className="space-y-1.5">
                      <Label htmlFor={`${rowId}-date`}>{t("diary.field.date")}</Label>
                      <Input id={`${rowId}-date`} type="date" value={row.date} min={earliest} max={today} onChange={(e) => update(row.key, { date: e.target.value })} />
                    </div>
                    <div className="space-y-1.5">
                      <Label htmlFor={`${rowId}-time`}>{t("diary.field.time")}</Label>
                      <Input id={`${rowId}-time`} type="time" value={row.time} onChange={(e) => update(row.key, { time: e.target.value })} />
                    </div>
                    {row.kind === "blood_pressure" ? (
                      <>
                        <div className="space-y-1.5">
                          <Label htmlFor={`${rowId}-sys`}>{t("diary.field.systolic")}</Label>
                          <Input id={`${rowId}-sys`} inputMode="numeric" value={row.systolic} onChange={(e) => update(row.key, { systolic: e.target.value })} />
                        </div>
                        <div className="space-y-1.5">
                          <Label htmlFor={`${rowId}-dia`}>{t("diary.field.diastolic")}</Label>
                          <Input id={`${rowId}-dia`} inputMode="numeric" value={row.diastolic} onChange={(e) => update(row.key, { diastolic: e.target.value })} />
                        </div>
                        <div className="space-y-1.5">
                          <Label htmlFor={`${rowId}-pulse`}>{t("diary.field.pulse")}</Label>
                          <Input id={`${rowId}-pulse`} inputMode="numeric" value={row.pulse} onChange={(e) => update(row.key, { pulse: e.target.value })} />
                        </div>
                      </>
                    ) : (
                      <>
                        <div className="space-y-1.5">
                          <Label htmlFor={`${rowId}-glu`}>{t("diary.field.glucose")}</Label>
                          <Input id={`${rowId}-glu`} inputMode="decimal" value={row.glucose} onChange={(e) => update(row.key, { glucose: e.target.value })} />
                        </div>
                        <div className="space-y-1.5">
                          <Label htmlFor={`${rowId}-unit`}>{t("diary.field.unit")}</Label>
                          <Select id={`${rowId}-unit`} value={row.glucoseUnit} onChange={(e) => update(row.key, { glucoseUnit: e.target.value as DiaryDraftRow["glucoseUnit"] })}>
                            <option value="">{t("diary.context.choose")}</option>
                            <option value="mmol_l">mmol/L</option>
                            <option value="mg_dl">mg/dL</option>
                          </Select>
                        </div>
                        <div className="space-y-1.5">
                          <Label htmlFor={`${rowId}-ctx`}>{t("diary.field.context")}</Label>
                          <Select id={`${rowId}-ctx`} value={row.glucoseContext} onChange={(e) => update(row.key, { glucoseContext: e.target.value as DiaryDraftRow["glucoseContext"] })}>
                            <option value="">{t("diary.context.choose")}</option>
                            {DIARY_GLUCOSE_CONTEXTS.map((c) => (
                              <option key={c} value={c}>
                                {t(`diary.context.${c}` as MessageKey)}
                              </option>
                            ))}
                          </Select>
                        </div>
                      </>
                    )}
                  </div>

                  {row.suggested && (
                    <div className="flex items-center gap-2">
                      <input id={`${rowId}-confirm`} type="checkbox" className="h-4 w-4" checked={row.confirmed} onChange={(e) => update(row.key, { confirmed: e.target.checked })} />
                      <Label htmlFor={`${rowId}-confirm`}>{t("diary.row.confirm")}</Label>
                    </div>
                  )}

                  {showProblems && (
                    <ul role="alert" className="space-y-1 text-sm text-red-700 dark:text-red-300" data-testid="diary-row-problems">
                      {problems.map((p) => (
                        <li key={p}>{problemText(p)}</li>
                      ))}
                    </ul>
                  )}
                  {fb?.kind === "problems" && fb.problems.length > 0 && !showProblems && (
                    <ul role="alert" className="space-y-1 text-sm text-red-700 dark:text-red-300">
                      {fb.problems.map((p) => (
                        <li key={p}>{problemText(p)}</li>
                      ))}
                    </ul>
                  )}
                  {fb?.kind === "held" && (
                    <p role="alert" className="text-sm text-red-700 dark:text-red-300">
                      {HELD_READING_COPY.body}
                    </p>
                  )}
                  {fb?.kind === "failed" && (
                    <p role="alert" className="text-sm text-red-700 dark:text-red-300">
                      {t("diary.save_failed")}
                    </p>
                  )}
                  {fb?.kind === "closed" && (
                    <p role="alert" className="text-sm text-red-700 dark:text-red-300">
                      {t("diary.not_open_save")}
                    </p>
                  )}
                </CardContent>
              </Card>
            </li>
          );
        })}
      </ol>

      <div className="flex flex-wrap gap-2">
        <Button type="button" variant="outline" onClick={() => addRow("blood_pressure")}>
          {t("diary.add_bp")}
        </Button>
        <Button type="button" variant="outline" onClick={() => addRow("glucose")}>
          {t("diary.add_glucose")}
        </Button>
      </div>

      <div className="space-y-2" aria-live="polite">
        {summary.unconfirmed > 0 && <p className="text-sm">{t("diary.unconfirmed", DEFAULT_LOCALE, { count: summary.unconfirmed })}</p>}
        {summary.blocked.length > 0 && <p className="text-sm">{t("diary.fix_first", DEFAULT_LOCALE, { count: summary.blocked.length })}</p>}
        {summary.tooMany && <p className="text-sm text-red-700 dark:text-red-300">{t("diary.too_many", DEFAULT_LOCALE, { max: LIMITS.maxRows })}</p>}
        {!isOnline && <p className="text-sm text-red-700 dark:text-red-300">{t("diary.offline")}</p>}
        {savedNote && (
          <p role="status" data-testid="diary-saved" className="rounded-md border border-brand-green/30 bg-brand-green/5 p-3 text-sm dark:bg-brand-green/15">
            {savedNote}
          </p>
        )}
      </div>

      <Button type="button" disabled={!canSave} onClick={() => void save()}>
        {saving ? t("diary.saving") : summary.ready.length === 0 ? t("diary.save_none") : t("diary.save", DEFAULT_LOCALE, { count: summary.ready.length })}
      </Button>
    </div>
  );
}
