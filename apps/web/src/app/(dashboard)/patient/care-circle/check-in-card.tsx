"use client";

import { useEffect, useState } from "react";
import { CHECKIN_WINDOW_MIN_MINUTES, checkInSnoozeSeconds, restoreCheckInSnooze, type CheckInSnoozeState } from "@tarragon/shared";
import { t, type Locale } from "@tarragon/i18n";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { FormError } from "@/components/ui/form-error";
import { useCheckInEnabled, useCheckInPending, useRespondCheckIn } from "@/lib/queries/care-circle";

const SNOOZE_KEY = "tarragon.checkin.snooze_until";
function readDeadline(): number | null {
  try {
    const raw = window.sessionStorage.getItem(SNOOZE_KEY);
    return raw === null ? null : Number(raw);
  } catch {
    return null;
  }
}
function writeDeadline(ms: number): void {
  try {
    window.sessionStorage.setItem(SNOOZE_KEY, String(ms));
  } catch {
    /* no storage: the snooze still works for this page view */
  }
}
function clearDeadline(): void {
  try {
    window.sessionStorage.removeItem(SNOOZE_KEY);
  } catch {
    /* nothing to clear */
  }
}

/**
 * S29e: a question from someone in the circle is waiting. The patient answers with one tap and nobody else is told. Never says who
 * asked. Mounted in the patient layout so it does not depend on a notification arriving or on being on one page, and shown only while
 * a question is waiting (so with the go-live off it is never on screen and never polls).
 */
export function CheckInCard({ locale }: { locale: Locale }) {
  const enabled = useCheckInEnabled();
  const pending = useCheckInPending();
  const respond = useRespondCheckIn();
  const [outcome, setOutcome] = useState<"answered" | "too_late" | null>(null);
  // UI-B: one snooze per question. "snoozed" hides the card for a short while, "asked_again" is the second showing (no further snooze).
  // The deadline is kept for this browser session so a reload cannot give a second snooze (the question has no id the client can read).
  const [snooze, setSnooze] = useState<CheckInSnoozeState>(() => restoreCheckInSnooze(readDeadline(), Date.now()));
  const waiting = pending.data === true;

  // A later question starts clean: an old "thank you" must never hide a new button (adjusted while rendering, not in an effect).
  const [wasWaiting, setWasWaiting] = useState(waiting);
  if (waiting !== wasWaiting) {
    setWasWaiting(waiting);
    if (waiting) setOutcome(null);
    else {
      // The question ended (answered, or run out): the next one may be snoozed once again.
      clearDeadline();
      setSnooze("none");
    }
  }
  useEffect(() => {
    if (snooze !== "snoozed") return;
    const left = Math.max(0, (readDeadline() ?? 0) - Date.now());
    const timer = setTimeout(() => setSnooze("asked_again"), left);
    return () => clearTimeout(timer);
  }, [snooze]);
  // The layout is on every page, so the thank-you goes away by itself.
  useEffect(() => {
    if (outcome === null) return;
    const timer = setTimeout(() => setOutcome(null), 10_000);
    return () => clearTimeout(timer);
  }, [outcome]);

  if (outcome === "answered") return <p role="status" className="text-sm">{t("checkin.responded", locale)}</p>;
  if (outcome === "too_late") return <p role="status" className="text-sm">{t("checkin.too_late", locale)}</p>;
  // One flaky poll must not take the button away while the last known answer is "waiting": keep it, and say the read failed beside it.
  // A failed read is only worth saying when the feature is known to be on; if the go-live cannot be read (or the app is ahead of its
  // database), the card stays silent rather than telling every patient something is wrong.
  if (!waiting) return pending.isError && enabled.data === true ? <p role="status" className="text-sm">{t("checkin.read_failed", locale)}</p> : null;
  if (snooze === "snoozed") return null;
  const again = snooze === "asked_again";
  return (
    <Card>
      <CardHeader><CardTitle>{again ? t("uib.checkin.again_title", locale) : t("checkin.pending_title", locale)}</CardTitle></CardHeader>
      <CardContent className="space-y-3">
        <p>{again ? t("uib.checkin.again_body", locale) : t("checkin.pending_body", locale)}</p>
        <p className="text-sm">{t("uib.checkin.limit_note", locale)}</p>
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
        {again ? null : (
          <Button type="button" variant="outline" className="ml-2 min-h-11" disabled={respond.isPending} onClick={() => {
            // The live window is decided on the server and cannot be read here, so the snooze is sized against the shortest window it allows.
            writeDeadline(Date.now() + checkInSnoozeSeconds(CHECKIN_WINDOW_MIN_MINUTES) * 1000);
            setSnooze("snoozed");
          }}>
            {t("uib.checkin.snooze", locale)}
          </Button>
        )}
        {pending.isError ? <p role="status" className="text-sm">{t("checkin.read_failed", locale)}</p> : null}
        <FormError id="checkin-respond-error" message={respond.isError ? t("checkin.error", locale) : null} />
      </CardContent>
    </Card>
  );
}
