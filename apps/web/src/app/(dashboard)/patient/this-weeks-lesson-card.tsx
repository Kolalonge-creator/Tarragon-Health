"use client";

import Link from "next/link";
import { useLearningThisWeek } from "@/lib/queries/learning-centre";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { SEMANTIC_ICON } from "@/lib/icons";

/**
 * "This week's lesson" on Today (S55, 9.2). One short lesson (five minutes or less), weekly pacing, never a daily push. It
 * renders nothing when there is no lesson to offer: no empty state to nag about, and no lesson ever past its review date
 * (the database function applies the same rule as the library).
 */
export function ThisWeeksLessonCard({ patientId }: { patientId: string }) {
  const { data: lesson } = useLearningThisWeek(patientId);
  if (!lesson) return null;
  const Icon = SEMANTIC_ICON.learn;
  return (
    <Card data-testid="this-weeks-lesson">
      <CardHeader>
        <div className="flex flex-wrap items-center gap-2">
          <Icon className="h-5 w-5 text-brand-green dark:text-brand-green-bright" aria-hidden />
          <CardTitle>{lesson.is_current_week ? "This week's lesson" : "A lesson to catch up on"}</CardTitle>
          {lesson.estimated_minutes ? <Badge variant="grey">{lesson.estimated_minutes} min</Badge> : null}
        </div>
      </CardHeader>
      <CardContent className="space-y-2">
        <p className="text-sm font-medium text-charcoal-ink dark:text-night-ink">{lesson.title}</p>
        {lesson.summary && <p className="text-sm text-charcoal-ink/70 dark:text-night-ink/70">{lesson.summary}</p>}
        <Link
          href={`/patient/learn/${encodeURIComponent(lesson.code)}`}
          className="inline-block text-sm font-medium text-brand-green dark:text-brand-green-bright underline"
        >
          Start the lesson
        </Link>
      </CardContent>
    </Card>
  );
}
