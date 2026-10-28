import { useEffect, useState } from "react";
import { asLocale, t } from "@tarragon/i18n";
import { recheckCountdown } from "@/lib/recheck-countdown";
import type { PendingRecheck } from "@/lib/triage-device";
import { useUiLanguage } from "@/lib/ui-language";
import { InlineAlert } from "@/ui/kit";

const TICK_MS = 15_000;

/**
 * The visible countdown for the repeat reading the signed rule set asked for. It owns its own clock, so the quarter-minute tick
 * re-renders only this card and not the whole vitals screen with its charts. It shows a time and nothing clinical: the wording of
 * what to do is the rule set's own card, and this never replaces, hides or delays emergency guidance or the symptom question.
 */
export function RecheckCountdownCard({ pending }: { pending: PendingRecheck | null }) {
  const locale = asLocale(useUiLanguage());
  const [nowMs, setNowMs] = useState(() => Date.now());
  const dueAtMs = pending?.dueAtMs;
  useEffect(() => {
    if (dueAtMs === undefined) return;
    setNowMs(Date.now());
    const id = setInterval(() => setNowMs(Date.now()), TICK_MS);
    return () => clearInterval(id);
  }, [dueAtMs]);

  const c = recheckCountdown(dueAtMs, nowMs, pending?.expiresAtMs ?? null);
  if (c.state === "waiting") {
    return (
      <InlineAlert
        tone="info"
        message={`${t("recheck.waiting_title", locale, { time: c.dueTime })}. ${t(c.minutesLeft === 1 ? "recheck.left_one" : "recheck.left_other", locale, { minutes: c.minutesLeft })}`}
      />
    );
  }
  if (c.state === "due") return <InlineAlert tone="warn" message={`${t("recheck.due_title", locale)}. ${t("recheck.due_body", locale)}`} />;
  return null;
}
