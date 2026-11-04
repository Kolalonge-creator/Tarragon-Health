"use client";

import { t, circleToolsTaskKindKey, type Locale } from "@tarragon/i18n";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { formatPatientDate } from "@/lib/format-date";
import { testCodeLabel } from "@/lib/labs/test-code-labels";
import type { TimelineEvent } from "@/lib/care-circle/model";
import { useSupporterTimeline } from "@/lib/queries/care-circle";

const MUTED = "text-charcoal-ink/70 dark:text-night-ink/70";

/** The plain-words line for one event. Built only from a fixed kind and a code (a test code or a help-request kind): never free text. */
export function timelineLine(e: TimelineEvent, locale: Locale): string {
  switch (e.kind) {
    case "test_requested":
    case "test_reviewed":
      return t(`circlep4.timeline.${e.kind}`, locale, { test: testCodeLabel(e.code ?? "") });
    case "help_requested":
    case "help_done":
      return t(`circlep4.timeline.${e.kind}`, locale, { kind: t(circleToolsTaskKindKey(e.code ?? ""), locale).toLowerCase() });
    default:
      return t(`circlep4.timeline.${e.kind}`, locale);
  }
}

/**
 * Care Circle P4 (spec 11): the last 90 days of events this supporter may see, newest first. The database builds it from the same
 * permissions as the blocks above it, so a missing event means "not shared". Hidden while loading; a failed read says so calmly.
 */
export function SupporterTimeline({ patientId, name, locale }: { patientId: string; name: string; locale: Locale }) {
  const timeline = useSupporterTimeline(patientId);
  if (timeline.isPending) return null;
  return (
    <Card>
      <CardHeader><CardTitle>{t("circlep4.timeline.title", locale)}</CardTitle></CardHeader>
      <CardContent>
        {timeline.isError ? <p className={MUTED}>{t("circlep4.timeline.error", locale)}</p> : null}
        {timeline.isSuccess && timeline.data.length === 0 ? <p className={MUTED}>{t("circlep4.timeline.empty", locale)}</p> : null}
        <ol className="divide-y">
          {(timeline.data ?? []).map((e, i) => (
            <li key={`${e.at}-${e.kind}-${i}`} className="py-2">
              <p>{timelineLine(e, locale)}</p>
              <p className={`text-sm ${MUTED}`}>
                {formatPatientDate(e.at)} · {t(`circlep4.timeline.source.${e.source}`, locale, { name })}
              </p>
            </li>
          ))}
        </ol>
      </CardContent>
    </Card>
  );
}
