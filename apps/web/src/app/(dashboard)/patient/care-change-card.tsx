"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  buildChangeSentences,
  historyLine,
  outcomeMessageKey,
  signedLine,
  splitCareChanges,
  t,
  type CareChange,
  type Locale,
  type MessageKey,
  type MessageParams,
} from "@tarragon/i18n";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { formatPatientDate } from "@/lib/format-date";
import { confirmCareChange, declineCareChange } from "./care-change-actions";

const MUTED = "text-charcoal-ink/70 dark:text-night-ink/70";

/**
 * "Your care team has a change for you" (S24). What would change, shown as before and after in plain words, why
 * (the sentence the signer wrote, never a clinical rationale), who signed it and when (null-gated), and two buttons
 * of equal weight. Nothing is pre-ticked, there is no countdown and no urgency colour: a change takes effect only when
 * the patient says yes.
 */
function WaitingChange({ change, locale }: { change: CareChange; locale: Locale }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [message, setMessage] = useState<MessageKey | null>(null);
  const tr = (key: MessageKey, params?: MessageParams) => t(key, locale, params);
  const sentences = buildChangeSentences(change, tr);
  const signed = signedLine(change, (iso) => formatPatientDate(iso), tr);

  function answer(kind: "yes" | "no") {
    setMessage(null);
    startTransition(async () => {
      if (kind === "yes") {
        const result = await confirmCareChange({ changeId: change.id });
        setMessage(result.ok ? outcomeMessageKey(result.outcome, change.kind) : result.key);
      } else {
        const result = await declineCareChange({ changeId: change.id });
        setMessage(result.key);
      }
      router.refresh();
    });
  }

  return (
    <li className="space-y-3 py-4">
      <p className="text-sm font-medium text-charcoal-ink dark:text-night-ink">{sentences.heading}</p>
      <div className="space-y-1">
        <p className={`text-xs ${MUTED}`}>{tr("careChange.what")}</p>
        {sentences.before !== null && (
          <p className="text-sm text-charcoal-ink dark:text-night-ink">
            <span className={MUTED}>{tr("careChange.before")}: </span>
            {sentences.before}
          </p>
        )}
        {sentences.after !== null && (
          <p className="text-sm text-charcoal-ink dark:text-night-ink">
            <span className={MUTED}>{tr("careChange.after")}: </span>
            {sentences.after}
          </p>
        )}
      </div>
      {change.summary && (
        <div className="space-y-1">
          <p className={`text-xs ${MUTED}`}>{tr("careChange.why")}</p>
          <p className="text-sm text-charcoal-ink dark:text-night-ink">{change.summary}</p>
        </div>
      )}
      {signed && <p className={`text-xs ${MUTED}`}>{signed}</p>}
      <p className="text-sm text-charcoal-ink dark:text-night-ink">{tr("careChange.promise")}</p>
      <div className="flex flex-wrap gap-3">
        <Button type="button" variant="outline" className="min-h-11" disabled={pending} onClick={() => answer("yes")}>
          {tr("careChange.yes")}
        </Button>
        <Button type="button" variant="outline" className="min-h-11" disabled={pending} onClick={() => answer("no")}>
          {tr("careChange.no")}
        </Button>
      </div>
      <p role="status" aria-live="polite" className="text-sm text-charcoal-ink dark:text-night-ink">
        {pending ? tr("careChange.working") : message ? tr(message) : null}
      </p>
    </li>
  );
}

export function CareChangeCard({ changes, locale }: { changes: CareChange[]; locale: Locale }) {
  const { waiting, history } = splitCareChanges(changes);
  const tr = (key: MessageKey, params?: MessageParams) => t(key, locale, params);
  if (waiting.length === 0 && history.length === 0) return null;
  const lines = history
    .map((c) => ({ id: c.id, line: historyLine(c, (iso) => formatPatientDate(iso), tr) }))
    .filter((h): h is { id: string; line: string } => h.line !== null);

  return (
    <Card>
      <CardHeader>
        <CardTitle>{tr("careChange.title")}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        {waiting.length > 0 && (
          <ul className="divide-y divide-charcoal-ink/10 dark:divide-night-ink/15">
            {waiting.map((c) => (
              <WaitingChange key={c.id} change={c} locale={locale} />
            ))}
          </ul>
        )}
        {lines.length > 0 && (
          <div className="space-y-1">
            <p className={`text-xs ${MUTED}`}>{tr("careChange.history.title")}</p>
            <ul className="space-y-1">
              {lines.map((h) => (
                <li key={h.id} className={`text-sm ${MUTED}`}>
                  {h.line}
                </li>
              ))}
            </ul>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
