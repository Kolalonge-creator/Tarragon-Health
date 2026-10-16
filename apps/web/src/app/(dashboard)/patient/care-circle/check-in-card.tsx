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

  // A later question starts clean: an old "thank you" must never hide a new button (adjusted while rendering, not in an effect).
  const [wasWaiting, setWasWaiting] = useState(waiting);
  if (waiting !== wasWaiting) {
    setWasWaiting(waiting);
    if (waiting) setOutcome(null);
  }
  // The layout is on every page, so the thank-you goes away by itself.
  useEffect(() => {
    if (outcome === null) return;
    const timer = setTimeout(() => setOutcome(null), 10_000);
    return () => clearTimeout(timer);
  }, [outcome]);

  if (outcome === "answered") return <p role="status" className="text-sm">{t("checkin.responded", locale)}</p>;
  if (outcome === "too_late") return <p role="status" className="text-sm">{t("checkin.too_late", locale)}</p>;
  // One flaky poll must not take the button away while the last known answer is "waiting": keep it, and say the read failed beside it.
  if (!waiting) return pending.isError ? <p role="status" className="text-sm">{t("checkin.read_failed", locale)}</p> : null;
  return (
    <Card>
      <CardHeader><CardTitle>{t("checkin.pending_title", locale)}</CardTitle></CardHeader>
      <CardContent className="space-y-3">
        <p>{t("checkin.pending_body", locale)}</p>
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
          {t("checkin.respond", locale)}
        </Button>
        {pending.isError ? <p role="status" className="text-sm">{t("checkin.read_failed", locale)}</p> : null}
        <FormError id="checkin-respond-error" message={respond.isError ? t("checkin.error", locale) : null} />
      </CardContent>
    </Card>
  );
}
