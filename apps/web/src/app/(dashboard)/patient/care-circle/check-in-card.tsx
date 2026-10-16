"use client";

import { useEffect, useState } from "react";
import { t, type Locale } from "@tarragon/i18n";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { FormError } from "@/components/ui/form-error";
import { useCheckInPending, useRespondCheckIn } from "@/lib/queries/care-circle";

/**
 * S29e: a question from someone in the circle is waiting. The patient answers with one tap and nobody else is told. Never says who
 * asked. Mounted in the patient layout so it does not depend on a notification arriving or on being on one page, and shown only while
 * a question is waiting (so with the go-live off it is never on screen and never polls).
 */
export function CheckInCard({ locale }: { locale: Locale }) {
  const pending = useCheckInPending();
  const respond = useRespondCheckIn();
  const [outcome, setOutcome] = useState<"answered" | "too_late" | null>(null);
  const waiting = pending.data === true;

  // A later question starts clean: an old "thank you" must never hide a new button.
  useEffect(() => {
    if (waiting) setOutcome(null);
  }, [waiting]);

  if (outcome === "answered") return <p role="status" className="text-sm">{t("circle.checkin.responded", locale)}</p>;
  if (outcome === "too_late") return <p role="status" className="text-sm">{t("circle.checkin.too_late", locale)}</p>;
  if (pending.isError) return <p role="status" className="text-sm">{t("circle.checkin.read_failed", locale)}</p>;
  if (!waiting) return null;
  return (
    <Card>
      <CardHeader><CardTitle>{t("circle.checkin.pending_title", locale)}</CardTitle></CardHeader>
      <CardContent className="space-y-3">
        <p>{t("circle.checkin.pending_body", locale)}</p>
        <Button
          type="button"
          className="min-h-11"
          disabled={respond.isPending}
          onClick={async () => {
            try {
              setOutcome((await respond.mutateAsync()) ? "answered" : "too_late");
            } catch {
              /* shown below */
            }
          }}
        >
          {t("circle.checkin.respond", locale)}
        </Button>
        <FormError id="checkin-respond-error" message={respond.isError ? t("circle.checkin.error", locale) : null} />
      </CardContent>
    </Card>
  );
}
