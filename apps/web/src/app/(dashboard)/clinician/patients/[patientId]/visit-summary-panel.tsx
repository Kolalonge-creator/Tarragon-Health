"use client";

import { useCallback, useEffect, useState, useTransition } from "react";
import {
  AVS_ITEM_KINDS,
  AVS_PROBLEM_KEYS,
  AVS_STATE_KEYS,
  avsCopyProblems,
  avsItemLabel,
  avsLongSentenceCount,
  t,
  type AvsCopyProblem,
} from "@tarragon/i18n";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import type { ItemParams, VisitSummaryReview } from "@/lib/visit-summary/schemas";
import {
  approveVisitSummary,
  loadVisitSummaryReview,
  saveVisitSummaryDraft,
  startVisitSummaryDraft,
  withdrawVisitSummary,
} from "./visit-summary-actions";

interface EditItem {
  id?: string;
  kind: string;
  params: ItemParams;
  customText: string;
  dueOn: string;
  fromSource: boolean;
}

const L = "en" as const;

/**
 * Draft, review and approve the after-visit summary for one signed note (AVS). The draft is built by the database from the
 * signed note and the signed orders of the same visit; nothing here calls a language model. The patient sees the summary
 * only after Approve, and only while the note stays signed, unwithdrawn and unamended.
 */
export function VisitSummaryPanel({ noteId }: { noteId: string }) {
  // Closed until opened: opening is an audited read of the chart (INV-10), so it is never done for every note on a page load.
  const [open, setOpen] = useState(false);
  const [review, setReview] = useState<VisitSummaryReview | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [text, setText] = useState("");
  const [items, setItems] = useState<EditItem[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [problems, setProblems] = useState<AvsCopyProblem[]>([]);
  const [withdrawing, setWithdrawing] = useState(false);
  const [reason, setReason] = useState("");
  const [pending, start] = useTransition();

  const apply = useCallback((r: VisitSummaryReview) => {
    setReview(r);
    setText(r.summary?.summary_text ?? "");
    setItems(
      r.items.map((i) => ({
        id: i.id,
        kind: i.kind,
        params: i.params,
        customText: i.custom_text ?? "",
        dueOn: i.due_on ?? "",
        fromSource: i.source_table !== null,
      })),
    );
  }, []);

  const [reloadKey, setReloadKey] = useState(0);
  const load = useCallback(() => {
    setReloadKey((k) => k + 1);
    return Promise.resolve();
  }, []);

  useEffect(() => {
    if (!open) return;
    let alive = true;
    void loadVisitSummaryReview({ noteId }).then((res) => {
      if (!alive) return;
      if (res.review) {
        setLoadError(null);
        apply(res.review);
      } else {
        setLoadError(res.error ?? t("avs.review.error.generic", L));
      }
    });
    return () => {
      alive = false;
    };
  }, [open, noteId, reloadKey, apply]);

  const state = review?.summary?.state ?? null;
  const editable = state === "draft";
  const liveProblems = avsCopyProblems(`${text}\n${items.map((i) => i.customText).join("\n")}`);
  const longSentences = avsLongSentenceCount(text);

  function save(): Promise<boolean> {
    const summaryId = review?.summary?.id;
    if (!summaryId) return Promise.resolve(false);
    return saveVisitSummaryDraft({
      summaryId,
      text,
      items: items.map((i) => ({
        ...(i.id ? { id: i.id } : {}),
        kind: i.kind,
        params: i.params,
        customText: i.customText,
        ...(i.dueOn ? { dueOn: i.dueOn } : {}),
      })),
    }).then((r) => {
      if (r.error) {
        setError(r.error);
        return false;
      }
      setError(null);
      return true;
    });
  }

  if (!open) {
    return (
      <Button size="sm" variant="outline" onClick={() => setOpen(true)}>
        {t("avs.review.title", L)}
      </Button>
    );
  }
  if (loadError && !review) {
    return (
      <p role="alert" className="text-xs text-red-600">
        {loadError}
      </p>
    );
  }
  if (!review) return null;
  if (!review.note_signed) return <p className="text-xs text-charcoal-ink/60">{t("avs.review.note_unsigned", L)}</p>;

  return (
    <section aria-label={t("avs.review.title", L)} className="space-y-3 rounded-md border border-charcoal-ink/10 p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h4 className="text-sm font-medium">{t("avs.review.title", L)}</h4>
        {state && <Badge variant={state === "approved" ? "green" : state === "withdrawn" ? "red" : "amber"}>{t(AVS_STATE_KEYS[state], L)}</Badge>}
      </div>

      {review.note_protected && <p className="text-xs text-charcoal-ink/70">{t("avs.review.protected", L)}</p>}
      {review.stale && (
        <p role="alert" className="text-xs text-amber-800">
          {t("avs.review.stale", L)}
        </p>
      )}
      {state === "approved" && !review.patient_can_see && !review.stale && (
        <p className="text-xs text-charcoal-ink/70">{t("avs.review.not_visible", L)}</p>
      )}

      {state === null && (
        <>
          <p className="text-xs text-charcoal-ink/70">{t("avs.review.intro", L)}</p>
          <Button
            size="sm"
            disabled={pending}
            onClick={() =>
              start(async () => {
                const r = await startVisitSummaryDraft({ noteId });
                if (r.error) setError(r.error);
                else {
                  setError(null);
                  await load();
                }
              })
            }
          >
            {t("avs.review.start", L)}
          </Button>
        </>
      )}

      {state !== null && (
        <>
          {editable && <p className="text-xs text-charcoal-ink/70">{t("avs.review.intro", L)}</p>}
          <div>
            <Label htmlFor={`avs-text-${noteId}`}>{t("avs.review.text", L)}</Label>
            <Textarea id={`avs-text-${noteId}`} rows={6} value={text} disabled={!editable} onChange={(e) => setText(e.target.value)} />
          </div>

          <div className="space-y-2">
            <p className="text-sm font-medium">{t("avs.review.checklist", L)}</p>
            <ul className="space-y-2">
              {items.map((item, idx) => (
                <li key={item.id ?? `new-${idx}`} className="space-y-1 rounded-md bg-charcoal-ink/5 p-2">
                  <p className="text-xs text-charcoal-ink/70">{avsItemLabel({ kind: item.kind, params: item.params, customText: item.customText }, L)}</p>
                  {editable && (
                    <div className="grid gap-2 sm:grid-cols-[10rem_1fr_9rem_auto]">
                      <Select aria-label="Step type" value={item.kind} onChange={(e) => setItems(items.map((x, j) => (j === idx ? { ...x, kind: e.target.value } : x)))}>
                        {AVS_ITEM_KINDS.map((k) => (
                          <option key={k} value={k}>
                            {k.replace("_", " ")}
                          </option>
                        ))}
                      </Select>
                      <Input
                        aria-label="Your own words for this step"
                        maxLength={400}
                        value={item.customText}
                        onChange={(e) => setItems(items.map((x, j) => (j === idx ? { ...x, customText: e.target.value } : x)))}
                      />
                      <Input
                        type="date"
                        aria-label="Date"
                        value={item.dueOn}
                        onChange={(e) => setItems(items.map((x, j) => (j === idx ? { ...x, dueOn: e.target.value } : x)))}
                      />
                      <Button size="sm" variant="outline" onClick={() => setItems(items.filter((_, j) => j !== idx))}>
                        {t("avs.review.remove_item", L)}
                      </Button>
                    </div>
                  )}
                </li>
              ))}
            </ul>
            {editable && (
              <Button size="sm" variant="outline" onClick={() => setItems([...items, { kind: "custom", params: {}, customText: "", dueOn: "", fromSource: false }])}>
                {t("avs.review.add_item", L)}
              </Button>
            )}
          </div>

          {liveProblems.length > 0 && (
            <ul role="alert" className="list-disc pl-5 text-xs text-red-700">
              {liveProblems.map((p) => (
                <li key={p}>{t(AVS_PROBLEM_KEYS[p], L)}</li>
              ))}
            </ul>
          )}
          {editable && longSentences > 0 && <p className="text-xs text-charcoal-ink/70">{t("avs.review.advice.long_sentence", L)}</p>}
          {error && (
            <p role="alert" className="text-xs text-red-600">
              {error}
            </p>
          )}
          {problems.length > 0 && (
            <ul className="list-disc pl-5 text-xs text-red-700">
              {problems.map((p) => (
                <li key={p}>{t(AVS_PROBLEM_KEYS[p], L)}</li>
              ))}
            </ul>
          )}

          {editable && (
            <div className="space-y-1">
              <div className="flex flex-wrap gap-2">
                <Button size="sm" variant="outline" disabled={pending} onClick={() => start(async () => void (await save()))}>
                  {t("avs.review.save", L)}
                </Button>
                <Button
                  size="sm"
                  disabled={pending || liveProblems.length > 0}
                  onClick={() =>
                    start(async () => {
                      if (!(await save())) return;
                      const summaryId = review.summary?.id;
                      if (!summaryId) return;
                      const r = await approveVisitSummary({ summaryId, text });
                      if (r.error) {
                        setError(r.error);
                        setProblems((r.problems ?? []).filter((p): p is AvsCopyProblem => p in AVS_PROBLEM_KEYS));
                        return;
                      }
                      setError(null);
                      setProblems([]);
                      await load();
                    })
                  }
                >
                  {t("avs.review.approve", L)}
                </Button>
              </div>
              <p className="text-xs text-charcoal-ink/60">{t("avs.review.approve_hint", L)}</p>
            </div>
          )}

          {state === "approved" && review.summary && (
            <div className="space-y-2">
              {review.summary.approved_by_name && review.summary.approved_at && (
                <p className="text-xs text-charcoal-ink/70">
                  {t("avs.checked_by", L, {
                    name: review.summary.approved_by_name,
                    date: new Date(review.summary.approved_at).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" }),
                  })}
                </p>
              )}
              {review.stale && (
                <Button
                  size="sm"
                  disabled={pending}
                  onClick={() =>
                    start(async () => {
                      const r = await startVisitSummaryDraft({ noteId });
                      if (r.error) setError(r.error);
                      else await load();
                    })
                  }
                >
                  {t("avs.review.start", L)}
                </Button>
              )}
              {withdrawing ? (
                <div className="space-y-2">
                  <Label htmlFor={`avs-why-${noteId}`}>{t("avs.review.withdraw_reason", L)}</Label>
                  <Textarea id={`avs-why-${noteId}`} rows={2} value={reason} maxLength={1000} onChange={(e) => setReason(e.target.value)} />
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={pending}
                    onClick={() =>
                      start(async () => {
                        const summaryId = review.summary?.id;
                        if (!summaryId) return;
                        const r = await withdrawVisitSummary({ summaryId, reason });
                        if (r.error) setError(r.error);
                        else {
                          setError(null);
                          setWithdrawing(false);
                          setReason("");
                          await load();
                        }
                      })
                    }
                  >
                    {t("avs.review.withdraw", L)}
                  </Button>
                </div>
              ) : (
                <Button size="sm" variant="outline" onClick={() => setWithdrawing(true)}>
                  {t("avs.review.withdraw", L)}
                </Button>
              )}
            </div>
          )}

          {state === "withdrawn" && (
            <div className="space-y-1">
              {review.summary?.withdrawn_reason && <p className="text-xs text-charcoal-ink/70">{review.summary.withdrawn_reason}</p>}
              <Button
                size="sm"
                disabled={pending}
                onClick={() =>
                  start(async () => {
                    const r = await startVisitSummaryDraft({ noteId });
                    if (r.error) setError(r.error);
                    else await load();
                  })
                }
              >
                {t("avs.review.start", L)}
              </Button>
            </div>
          )}
        </>
      )}
      {state === null && error && (
        <p role="alert" className="text-xs text-red-600">
          {error}
        </p>
      )}
    </section>
  );
}
