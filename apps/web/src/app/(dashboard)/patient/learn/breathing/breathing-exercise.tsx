"use client";

import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { t, type Locale, type MessageKey, type MessageParams } from "@tarragon/i18n";
import { bre01Pace, mayStartSession, stateAt, type BreathingState, type BreathingVariant } from "@tarragon/shared";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

const MUTED = "text-charcoal-ink/70 dark:text-night-ink/70";
const ACK_KEY = "breathing.safety_ack.v1";
const VARIANTS: { id: BreathingVariant; label: MessageKey }[] = [
  { id: "standard", label: "breathing.variant_standard" },
  { id: "gentle", label: "breathing.variant_gentle" },
  { id: "short", label: "breathing.variant_short" },
];

const readAck = (): boolean => {
  try {
    return window.localStorage.getItem(ACK_KEY) === "1";
  } catch {
    return false;
  }
};
const noSubscribe = () => () => {};
const REDUCED = "(prefers-reduced-motion: reduce)";
const subscribeReduced = (cb: () => void) => {
  const mq = window.matchMedia(REDUCED);
  mq.addEventListener("change", cb);
  return () => mq.removeEventListener("change", cb);
};

/**
 * BRE-01 on the web. A silent visual guide at about six breaths a minute with a longer out-breath, a safety card before
 * the first use and a Stop button on screen throughout. It stops when the tab is hidden rather than running unseen. A calm
 * moment, never shown as a treatment, and it says to keep taking medicines. The guide moves in two steps when the visitor's
 * system asks for reduced motion.
 */
export function BreathingExercise({ locale }: { locale: Locale }) {
  const tr = useCallback((key: MessageKey, params?: MessageParams) => t(key, locale, params), [locale]);
  // Until the browser answers, the safety card shows: the server render errs on the side of showing it.
  const storedAck = useSyncExternalStore(noSubscribe, readAck, () => false);
  const [ackedNow, setAckedNow] = useState(false);
  const acked = storedAck || ackedNow;
  const [running, setRunning] = useState(false);
  const [done, setDone] = useState(false);
  const [variant, setVariant] = useState<BreathingVariant>("standard");
  const [state, setState] = useState<BreathingState | null>(null);
  const reduced = useSyncExternalStore(subscribeReduced, () => window.matchMedia(REDUCED).matches, () => false);
  const startedAt = useRef(0);
  const pace = useMemo(() => bre01Pace(variant).pace, [variant]);

  const stop = useCallback(() => {
    setRunning(false);
    setState(null);
  }, []);

  useEffect(() => {
    if (!running) return;
    const onHide = () => {
      if (document.hidden) stop();
    };
    document.addEventListener("visibilitychange", onHide);
    const id = window.setInterval(() => {
      const next = stateAt(pace, Date.now() - startedAt.current);
      if (next.finished) {
        setRunning(false);
        setState(null);
        setDone(true);
      } else {
        setState(next);
      }
    }, 100);
    return () => {
      window.clearInterval(id);
      document.removeEventListener("visibilitychange", onHide);
    };
  }, [running, pace, stop]);

  function acknowledge() {
    try {
      window.localStorage.setItem(ACK_KEY, "1");
    } catch {
      // Not saving only means the card shows again next time.
    }
    setAckedNow(true);
  }

  function start() {
    if (!mayStartSession(acked)) return;
    startedAt.current = Date.now();
    setDone(false);
    setState(stateAt(pace, 0));
    setRunning(true);
  }

  const scale = state ? (reduced ? (state.phase === "in" ? 1 : 0.55) : 0.55 + 0.45 * state.fill) : 0.55;
  const phaseWord = state ? tr(state.phase === "in" ? "breathing.in" : "breathing.out") : "";

  return (
    <div className="space-y-4">
      <p className={`text-sm ${MUTED}`}>{tr("breathing.keep_medicines")}</p>

      {!acked && (
        <Card>
          <CardHeader>
            <CardTitle>{tr("breathing.safety_title")}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <p>{tr("breathing.safety_stop")}</p>
            <p>{tr("breathing.safety_ask")}</p>
            <p>{tr("breathing.safety_emergency")}</p>
            <Button onClick={acknowledge}>{tr("breathing.safety_ack")}</Button>
          </CardContent>
        </Card>
      )}

      {acked && !running && (
        <div className="space-y-3">
          {done && (
            <p role="status" className="text-lg">
              {tr("breathing.done")}
            </p>
          )}
          <div className="flex flex-wrap gap-2" role="radiogroup" aria-label={tr("breathing.title")}>
            {VARIANTS.map((v) => (
              <Button key={v.id} role="radio" aria-checked={variant === v.id} variant={variant === v.id ? "default" : "outline"} onClick={() => setVariant(v.id)}>
                {tr(v.label)}
              </Button>
            ))}
          </div>
          {reduced && <p className={`text-sm ${MUTED}`}>{tr("breathing.reduced_motion")}</p>}
          <Button onClick={start}>{done ? tr("breathing.again") : tr("breathing.start")}</Button>
        </div>
      )}

      {running && state && (
        <div className="flex flex-col items-center gap-4">
          <div role="timer" aria-label={`${phaseWord}, ${state.secondsLeft}`} className="relative flex h-56 w-56 items-center justify-center">
            <div
              className="absolute h-56 w-56 rounded-full bg-primary opacity-85"
              style={{ transform: `scale(${scale})`, transition: reduced ? "none" : "transform 100ms linear" }}
            />
            <div className="relative text-center text-primary-foreground">
              <div className="text-xl font-semibold">{phaseWord}</div>
              <div className="text-4xl font-bold">{state.secondsLeft}</div>
            </div>
          </div>
          <p aria-live="polite" className="sr-only">
            {phaseWord}
          </p>
          <p className={`text-sm ${MUTED}`}>{tr("breathing.breath_of", { n: state.breath, total: state.totalBreaths })}</p>
          <Button variant="outline" onClick={stop}>
            {tr("breathing.stop")}
          </Button>
        </div>
      )}
    </div>
  );
}
