"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { AVS_URGENT_KEY, avsItemLabel, t, type Locale } from "@tarragon/i18n";
import { visitFollowUpOpen } from "@tarragon/shared";
import { recordVisitSummaryOpened, useAddVisitItemToTasks, useMyVisitSummaries, useSetVisitItemDone } from "@/lib/queries/patient-visit-summaries";
import { formatPatientDate } from "@/lib/format-date";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { FormError, fieldErrorId } from "@/components/ui/form-error";

const MUTED = "text-charcoal-ink/70 dark:text-night-ink/70";
const TOUCH = "min-h-11";

/**
 * The after-visit summary (AVS): plain words from your care team, then a short "what happens next" list you can tick off.
 * The list works with no notification at all. The urgent-care block is the app's existing emergency wording on every summary.
 */
export function VisitSummaryCard({ locale, patientId, readOnly = false }: { locale: Locale; patientId: string; readOnly?: boolean }) {
  const summaries = useMyVisitSummaries(readOnly ? patientId : null);
  const setDone = useSetVisitItemDone();
  const addTask = useAddVisitItemToTasks();

  const list = summaries.data ?? [];
  // "Now" is read once when the card mounts (not during every render): the prompt only needs day-level accuracy.
  const [nowMs] = useState(() => Date.now());

  // Once per summary per page load; the database also keeps it to one record a day. A failure never blocks reading.
  const noted = useRef<Set<string>>(new Set());
  useEffect(() => {
    for (const s of summaries.data ?? []) {
      if (noted.current.has(s.id)) continue;
      noted.current.add(s.id);
      void recordVisitSummaryOpened(s.id).catch(() => undefined);
    }
  }, [summaries.data]);
  if (!summaries.isLoading && !summaries.isError && list.length === 0) return null;

  return (
    <Card id="after-visit-summary">
      <CardHeader>
        <CardTitle>{t("avs.title", locale)}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <p className={`text-sm ${MUTED}`}>{t("avs.intro", locale)}</p>
        {summaries.isError && <FormError id={fieldErrorId("avs-load")} message={t("avs.error.generic", locale)} />}
        {(setDone.isError || addTask.isError) && <FormError id={fieldErrorId("avs-write")} message={t("avs.error.generic", locale)} />}
        <ul className="space-y-4">
          {list.map((s) => (
            <li key={s.id} className="space-y-3 rounded-md border border-charcoal-ink/10 p-3 dark:border-night-ink/15">
              {s.approved_at && (
                <p className="text-xs font-medium">
                  {s.approved_by_name
                    ? t("avs.checked_by", locale, { name: s.approved_by_name, date: formatPatientDate(s.approved_at) })
                    : t("avs.checked_on", locale, { date: formatPatientDate(s.approved_at) })}
                </p>
              )}
              <p className="whitespace-pre-line text-sm text-charcoal-ink dark:text-night-ink">{s.summary_text}</p>

              <div className="space-y-2">
                <h3 className="text-sm font-medium">{t("avs.what_next", locale)}</h3>
                {s.items.length === 0 ? (
                  <p className={`text-sm ${MUTED}`}>{t("avs.what_next.empty", locale)}</p>
                ) : (
                  <ul className="space-y-2">
                    {s.items.map((item) => {
                      const done = item.done_at !== null;
                      const checkId = `avs-item-${item.id}`;
                      return (
                        <li key={item.id} className="flex flex-wrap items-start gap-3">
                          <input
                            id={checkId}
                            type="checkbox"
                            className="mt-1 h-5 w-5"
                            checked={done}
                            disabled={readOnly || setDone.isPending}
                            onChange={() => setDone.mutate({ itemId: item.id, done: !done })}
                          />
                          <label htmlFor={checkId} className={`min-w-0 flex-1 text-sm ${done ? "line-through opacity-70" : ""}`}>
                            {avsItemLabel({ kind: item.kind, params: item.params, customText: item.custom_text }, locale)}
                            {item.due_on && <span className={`block text-xs ${MUTED}`}>{t("avs.item.due", locale, { date: formatPatientDate(item.due_on) })}</span>}
                          </label>
                          {readOnly ? null : item.task_id ? (
                            <span className={`text-xs ${MUTED}`}>{t("avs.item.task_added", locale)}</span>
                          ) : (
                            <Button size="sm" variant="outline" className={TOUCH} disabled={addTask.isPending} onClick={() => addTask.mutate(item.id)}>
                              {t("avs.item.add_task", locale)}
                            </Button>
                          )}
                        </li>
                      );
                    })}
                  </ul>
                )}
              </div>

              {/* A prompt only (visit.follow_up_prompt): it makes the existing conversation easy to find; it adds no entitlement and promises no reply time. */}
              {!readOnly && s.approved_at && visitFollowUpOpen(s.approved_at, nowMs) && (
                <div className="space-y-2">
                  <h3 className="text-sm font-medium">{t("avs.followup.title", locale)}</h3>
                  <p className={`text-sm ${MUTED}`}>{t("avs.followup.body", locale, { date: formatPatientDate(s.approved_at) })}</p>
                  <Link href="/patient/messages" className={`inline-flex ${TOUCH} items-center rounded-md border px-4 text-sm font-medium`}>
                    {t("avs.followup.cta", locale)}
                  </Link>
                </div>
              )}

              <div role="note" className="rounded-md bg-charcoal-ink/5 p-3 dark:bg-night-ink/10">
                <h3 className="text-sm font-medium">{t("avs.urgent.title", locale)}</h3>
                <p className="text-sm">{t(AVS_URGENT_KEY, locale)}</p>
              </div>
            </li>
          ))}
        </ul>
      </CardContent>
    </Card>
  );
}
