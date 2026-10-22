"use client";

import { t, type MessageKey } from "@tarragon/i18n";
import { readinessMessageKeys } from "@tarragon/clinical/activity-readiness";
import { useReadiness } from "@/lib/queries/activity-readiness";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

/** Recovery, sleep and training-load bands from the person's own device. Renders nothing without device data (dormant). An estimate, never a ranking. */
export function ReadinessCard({ patientId }: { patientId: string }) {
  const q = useReadiness(patientId);
  if (!q.data) return null;
  const keys = readinessMessageKeys(q.data);
  const lines = [keys.recovery, keys.sleep, keys.load].filter((k): k is string => k !== null);
  return (
    <Card>
      <CardHeader>
        <CardTitle>{t("activity.readiness.title")}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-1.5">
        {lines.map((k) => (
          <p key={k} className="text-sm text-charcoal-ink dark:text-night-ink">
            {t(k as MessageKey)}
          </p>
        ))}
        <p className="text-xs text-charcoal-ink/60 dark:text-night-ink/60">{t("activity.readiness.estimate")}</p>
      </CardContent>
    </Card>
  );
}
