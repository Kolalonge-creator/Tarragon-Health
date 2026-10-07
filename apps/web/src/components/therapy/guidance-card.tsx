"use client";

import Link from "next/link";
import type { TherapyRoute } from "@tarragon/shared";
import { t, type MessageKey } from "@tarragon/i18n";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

/**
 * The card a programme shows when the entry screen or a per-session re-check stops it (14.9). It says what to do next in plain words.
 * It carries NO phone number and no helpline (CMO decision, 2026-10-07): the crisis route says to go to the nearest hospital now.
 * It never names the answer that stopped the programme, so a person glancing at a shared phone learns nothing about their health.
 */
export function TherapyGuidanceCard({ route, taskFailed = false, noRules = false }: { route: TherapyRoute | "clinician_review_pending" | "offline_stop" | null; taskFailed?: boolean; noRules?: boolean }) {
  const key = noRules || route === null ? "not_available" : route;
  const urgent = route === "crisis" || route === "same_day_clinician";
  return (
    <Card role="alert" className={urgent ? "border-red-300 dark:border-red-500/40" : undefined}>
      <CardHeader>
        <CardTitle className="text-base">{t(`therapy.guidance.${key}_title` as MessageKey)}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <p className="text-sm text-charcoal-ink/90 dark:text-night-ink/90">{t(`therapy.guidance.${key}` as MessageKey)}</p>
        {taskFailed && <p className="text-sm font-medium">{t("therapy.guidance.task_failed")}</p>}
        <Link href="/patient/programmes" className="text-sm font-medium text-brand-green dark:text-brand-green-bright underline">
          {t("therapy.guidance.back")}
        </Link>
      </CardContent>
    </Card>
  );
}
