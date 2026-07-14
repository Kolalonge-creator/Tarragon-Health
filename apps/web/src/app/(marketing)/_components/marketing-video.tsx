"use client";

import { useState } from "react";
import type { MarketingMediaSlot } from "../_content/media";
import { MarketingMediaFrame } from "./marketing-media-frame";
import { cn } from "@/lib/utils";

const WALKTHROUGH_STEPS = [
  "Log a reading in the app",
  "Your care team reviews the trend",
  "Reminders keep follow-up on track",
  "Family gets a calm update when needed",
] as const;

export function MarketingVideo({
  youtubeId,
  title,
  caption,
  poster,
}: {
  youtubeId?: string;
  title: string;
  caption: string;
  poster: MarketingMediaSlot;
}) {
  const [active, setActive] = useState(false);
  const [stepIndex, setStepIndex] = useState(0);
  const hasYoutube = Boolean(youtubeId?.trim());

  function handlePlay() {
    if (hasYoutube) {
      setActive(true);
      return;
    }
    setActive(true);
    setStepIndex(0);
  }

  function handleStepAdvance() {
    setStepIndex((current) => (current + 1) % WALKTHROUGH_STEPS.length);
  }

  return (
    <div className="grid items-center gap-10 lg:grid-cols-[1fr_1.1fr]">
      <div>
        <p className="text-sm font-medium uppercase tracking-wide text-deep-forest">Watch</p>
        <h2 className="mt-2 font-heading text-3xl font-semibold text-charcoal-ink sm:text-4xl">
          {title}
        </h2>
        <p className="mt-4 text-lg leading-relaxed text-charcoal-ink/70">{caption}</p>
        {!hasYoutube && active ? (
          <p className="mt-4 text-sm text-charcoal-ink/70">
            Full video walkthrough coming soon — tap the preview to step through how care stays
            connected.
          </p>
        ) : null}
      </div>

      <div className="relative">
        {!active ? (
          <button
            type="button"
            onClick={handlePlay}
            className="group relative block w-full text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-green focus-visible:ring-offset-2 rounded-3xl"
            // The poster illustration bakes in a visible "Calm follow-up call" caption,
            // so the accessible name must include it too (WCAG 2.5.3 Label in Name).
            aria-label={
              hasYoutube
                ? `Play video: ${title}`
                : `Preview how Tarragon works: ${title} — Calm follow-up call`
            }
          >
            <MarketingMediaFrame media={poster} />
            <span className="absolute inset-0 flex items-center justify-center rounded-3xl bg-clinical-navy/25 transition-colors group-hover:bg-clinical-navy/35">
              <span className="flex h-16 w-16 items-center justify-center rounded-full bg-white shadow-lg transition-transform group-hover:scale-105">
                <PlayIcon />
              </span>
            </span>
          </button>
        ) : hasYoutube && youtubeId ? (
          <div className="aspect-video overflow-hidden rounded-3xl border border-charcoal-ink/10 shadow-xl">
            <iframe
              title={title}
              src={`https://www.youtube-nocookie.com/embed/${youtubeId}?autoplay=1&rel=0`}
              className="h-full w-full"
              allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
              allowFullScreen
            />
          </div>
        ) : (
          <button
            type="button"
            onClick={handleStepAdvance}
            className={cn(
              "relative w-full rounded-3xl border border-brand-green/20 bg-white p-6 text-left shadow-xl",
              "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-green focus-visible:ring-offset-2"
            )}
            aria-label="Advance walkthrough preview"
          >
            <MarketingMediaFrame media={poster} className="shadow-none" />
            <div className="absolute inset-x-6 bottom-6 rounded-2xl bg-clinical-navy/90 px-5 py-4 text-white backdrop-blur-sm">
              <p className="text-xs font-medium uppercase tracking-wide text-white/60">
                Step {stepIndex + 1} of {WALKTHROUGH_STEPS.length}
              </p>
              <p className="mt-1 font-heading text-lg font-semibold">
                {WALKTHROUGH_STEPS[stepIndex]}
              </p>
              <p className="mt-2 text-sm text-white/70">Tap to see the next step</p>
            </div>
          </button>
        )}
      </div>
    </div>
  );
}

function PlayIcon() {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" aria-hidden>
      <path d="M9 7.5v9l8-4.5-8-4.5Z" className="fill-brand-green" />
    </svg>
  );
}
