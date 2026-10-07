"use client";

import { useState } from "react";
import { t } from "@tarragon/i18n";
import { Button } from "@/components/ui/button";
import { recordMediaSessionAction } from "./actions";

/** Walks through a reviewed static script one step at a time. Nothing is generated, scored or stored from what the person thinks. */
export function ExerciseStepper({ mediaId, steps }: { mediaId: string; steps: string[] }) {
  const [i, setI] = useState(0);
  const [done, setDone] = useState(false);
  if (steps.length === 0) return null;
  if (done) return <p role="status" className="text-sm">{t("library.player.done")}</p>;
  const last = i === steps.length - 1;
  return (
    <div className="space-y-3">
      <p className="text-xs text-charcoal-ink/60 dark:text-night-ink/60">{t("library.exercise.step", "en", { n: i + 1, total: steps.length })}</p>
      <p className="text-base" aria-live="polite">{steps[i]}</p>
      <Button
        type="button"
        onClick={() => {
          if (last) {
            setDone(true);
            void recordMediaSessionAction(mediaId, 600);
          } else setI(i + 1);
        }}
      >
        {last ? t("library.exercise.finish") : t("library.exercise.next")}
      </Button>
    </div>
  );
}
