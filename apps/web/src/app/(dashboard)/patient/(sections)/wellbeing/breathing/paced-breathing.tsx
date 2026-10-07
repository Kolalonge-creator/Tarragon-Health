"use client";

import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { breathPositionAt, type BreathingPattern } from "@tarragon/shared";
import { t, type MessageKey } from "@tarragon/i18n";
import { Button } from "@/components/ui/button";
import { recordMediaSessionAction } from "../library/actions";

function subscribeReducedMotion(cb: () => void): () => void {
  try {
    const m = window.matchMedia("(prefers-reduced-motion: reduce)");
    m.addEventListener("change", cb);
    return () => m.removeEventListener("change", cb);
  } catch {
    return () => undefined;
  }
}
function readReducedMotion(): boolean {
  try {
    return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  } catch {
    return false;
  }
}

/**
 * In-house paced breathing (10.7). The pattern and length come from a REVIEWED library item (the database refuses to publish one
 * outside the configured bounds). No health effect is claimed. The words alone work without any animation, and a person who asks
 * for reduced motion gets words only. S33's BRE-01 is not on this base; it can replace this renderer.
 */
export function PacedBreathing({ mediaId, pattern, totalSeconds, steps }: { mediaId: string; pattern: BreathingPattern; totalSeconds: number; steps: string[] }) {
  const [running, setRunning] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const reducedMotion = useSyncExternalStore(subscribeReducedMotion, readReducedMotion, () => false);
  const [textOverride, setTextOverride] = useState<boolean | null>(null);
  const textOnly = textOverride ?? reducedMotion;
  const startedAt = useRef(0);
  const recorded = useRef(false);

  useEffect(() => {
    if (!running) return;
    const id = window.setInterval(() => {
      const e = (Date.now() - startedAt.current) / 1000;
      setElapsed(e);
      if (e >= totalSeconds) {
        setRunning(false);
        if (!recorded.current) {
          recorded.current = true;
          void recordMediaSessionAction(mediaId, totalSeconds);
        }
      }
    }, 200);
    return () => window.clearInterval(id);
  }, [running, totalSeconds, mediaId]);

  const pos = breathPositionAt(pattern, totalSeconds, elapsed);
  const finished = !running && elapsed >= totalSeconds;
  const scale = pos.phase === "inhale" ? 0.6 + 0.4 * pos.progress : pos.phase === "exhale" ? 1 - 0.4 * pos.progress : 1;

  return (
    <div className="space-y-4">
      {steps.length > 0 && (
        <ul className="list-disc pl-5 text-sm">
          {steps.map((s, i) => (<li key={i}>{s}</li>))}
        </ul>
      )}
      <label className="flex items-center gap-2 text-sm">
        <input type="checkbox" checked={textOnly} onChange={(e) => setTextOverride(e.target.checked)} />
        {t("breathing.text_mode")}
      </label>
      <div className="flex flex-col items-center gap-3" aria-live="polite">
        {!textOnly && (
          <div
            aria-hidden="true"
            className="h-40 w-40 rounded-full bg-brand-green/20 border-2 border-brand-green"
            style={{ transform: `scale(${running ? scale : 0.6})`, transition: "transform 200ms linear" }}
          />
        )}
        <p className="text-xl font-medium">{running && pos.phase ? t(`breathing.phase.${pos.phase}` as MessageKey) : finished ? t("breathing.library_done") : ""}</p>
        {running && <p className="text-sm tabular-nums">{pos.secondsLeft}</p>}
        {running && <p className="text-xs text-charcoal-ink/60 dark:text-night-ink/60">{t("breathing.time_left", "en", { n: pos.remainingSeconds })}</p>}
      </div>
      {running ? (
        <Button type="button" variant="outline" onClick={() => setRunning(false)}>{t("breathing.stop")}</Button>
      ) : (
        <Button
          type="button"
          onClick={() => {
            startedAt.current = Date.now();
            recorded.current = false;
            setElapsed(0);
            setRunning(true);
          }}
        >
          {t("breathing.start")}
        </Button>
      )}
    </div>
  );
}
