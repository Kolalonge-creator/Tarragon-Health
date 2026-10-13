"use client";

import Link from "next/link";
import { t } from "@tarragon/i18n";
import { Button } from "@/components/ui/button";
import { useAcknowledgeFreeGuidance, useFreeGuidance } from "@/lib/queries/free-red-checkin";

/**
 * Two-tier (founder 2026-10-12): the Free rule for amber triage and heart-failure weight gain. Calm in-app guidance, the plain
 * sentence that no doctor was alerted because the patient is on the Free plan, and a route to Membership that never blocks
 * anything. Nothing here reaches a doctor.
 */
export function FreeGuidance({ patientId }: { patientId: string }) {
  const { data } = useFreeGuidance(patientId);
  const ack = useAcknowledgeFreeGuidance(patientId);
  if (!data) return null;
  const body = data.kind === "heart_failure" ? t("freered.heart_failure.body", "en") : t("freered.amber.body", "en");
  return (
    <section aria-labelledby="free-guidance-title" className="space-y-3 rounded-lg border border-charcoal-ink/10 p-4 text-sm text-charcoal-ink dark:border-night-ink/15 dark:text-night-ink">
      <h2 id="free-guidance-title" className="sr-only">
        {t("freered.checkin.title", "en")}
      </h2>
      <p>{body}</p>
      <p className="font-medium">{t("freered.no_doctor", "en")}</p>
      <div className="flex flex-wrap gap-3">
        <Link href="/patient/membership" className="inline-flex min-h-11 items-center rounded-md bg-brand-green px-3 py-2 font-medium text-white">
          {t("freered.join", "en")}
        </Link>
        <Button type="button" variant="outline" disabled={ack.isPending} onClick={() => ack.mutate(data.id)}>
          {t("freered.guidance.ok", "en")}
        </Button>
      </div>
    </section>
  );
}
