"use client";

import { useState } from "react";
import { t } from "@tarragon/i18n";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useRecordLesson } from "@/lib/queries/learning-quality";
import { GlossaryText } from "./glossary-text";
import { LearningItemFooter } from "./learning-item-footer";
import { UrgentHelpBox } from "./urgent-help-box";

/**
 * "What this reading means": a short lesson after a blood pressure, glucose or lab value lands in a band a clinician has keyed to one.
 * Behind the `record_triggered_lessons_enabled` guard (OFF), so by default this renders nothing at all. The urgent-help box always
 * outranks it: a recent red or emergency reading shows the urgent guidance and never a lesson. Mounted next to the weekly lesson card on
 * the Learn page and the dashboard (the Today screen can mount the same component).
 */
export function RecordLessonCard({ patientId }: { patientId: string }) {
  const { data } = useRecordLesson(patientId);
  const [open, setOpen] = useState(false);

  if (!data || data.kind === "off" || data.kind === "none") return null;

  if (data.kind === "urgent") {
    return (
      <Card data-testid="record-lesson-urgent">
        <CardContent className="space-y-3 pt-4">
          <p className="text-sm">{t("learn.record.urgent_lead")}</p>
          <UrgentHelpBox />
        </CardContent>
      </Card>
    );
  }

  return (
    <Card data-testid="record-lesson-card">
      <CardHeader>
        <p className="text-xs font-semibold uppercase tracking-wide text-brand-green dark:text-brand-green-bright">{t("learn.record.title")}</p>
        <CardTitle className="text-lg">{data.title}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        {!open ? (
          <Button size="sm" onClick={() => setOpen(true)}>
            {t("learn.record.open")}
          </Button>
        ) : (
          <div className="space-y-3">
            <GlossaryText text={data.body} className="whitespace-pre-line text-sm leading-relaxed text-charcoal-ink/90 dark:text-night-ink/90" />
            <LearningItemFooter code={data.code} title={data.title} />
            <Button size="sm" variant="outline" onClick={() => setOpen(false)}>
              {t("learn.record.hide")}
            </Button>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
