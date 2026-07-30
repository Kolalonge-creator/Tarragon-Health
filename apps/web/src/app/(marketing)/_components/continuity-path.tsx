"use client";

/** Signature continuity visual, echoes Guard Leaf checkmark vein (docs/MARKETING_SITE_SPEC.md §1).
 * Starts at "Screening" deliberately; the loop begins before anything is
 * wrong, so healthy visitors see themselves in it (prevention-first, 2026-07-23).
 * Interactive: clicking a moment (or a slow auto-advance until someone does)
 * reveals what actually happens then, matching the numbered-step-with-detail
 * pattern from functionhealth.com/superpower.com without inventing anything
 * beyond what's already true of the product. */

import { useEffect, useRef, useState } from "react";
import { cn } from "@/lib/utils";

const MOMENTS = [
  {
    label: "Screening",
    cx: 32,
    cy: 46,
    detail: "A personal screening and vaccination calendar is built for you, matched to your age and history.",
  },
  {
    label: "Reading",
    cx: 104,
    cy: 38,
    detail: "You log a reading, take a screening, or complete a check, through the app or web.",
  },
  {
    label: "Reminder",
    cx: 168,
    cy: 48,
    detail: "Due dates and missed check-ins get a gentle nudge before anything is overdue.",
  },
  {
    label: "Doctor call",
    cx: 244,
    cy: 33,
    detail: "Your care team reviews the trend and follows up, escalating to a doctor when it's needed.",
  },
  {
    label: "Follow-up",
    cx: 340,
    cy: 36,
    detail: "The loop continues on the same record: nothing is ever a one-off, and nothing gets dropped.",
  },
] as const;

export function ContinuityPath() {
  const [active, setActive] = useState(0);
  const interacted = useRef(false);

  useEffect(() => {
    if (typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      return;
    }
    const id = setInterval(() => {
      if (interacted.current) return;
      setActive((a) => (a + 1) % MOMENTS.length);
    }, 3200);
    return () => clearInterval(id);
  }, []);

  const select = (index: number) => {
    interacted.current = true;
    setActive(index);
  };

  return (
    <div className="relative mx-auto mt-10 max-w-2xl">
      <div className="relative motion-safe:opacity-0 motion-safe:[animation:marketing-fade-in_1s_ease-out_0.2s_forwards]">
        <svg
          viewBox="0 0 400 80"
          className="h-20 w-full text-brand-green/40"
          fill="none"
          xmlns="http://www.w3.org/2000/svg"
          aria-hidden
        >
          <path
            d="M20 50 C 80 20, 120 70, 180 45 S 280 15, 380 40"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
          />
          {MOMENTS.map(({ cx, cy }, index) => (
            <circle
              key={cx}
              cx={cx}
              cy={cy}
              r={index === active ? 6.5 : 5}
              className={cn("transition-all duration-300", index === active ? "fill-brand-green" : "fill-brand-green/50")}
            />
          ))}
        </svg>
        <div className="absolute inset-0" aria-hidden>
          {MOMENTS.map(({ cx, cy }, index) => (
            <button
              key={cx}
              type="button"
              tabIndex={-1}
              onClick={() => select(index)}
              className="absolute h-6 w-6 -translate-x-1/2 -translate-y-1/2 rounded-full"
              style={{ left: `${(cx / 400) * 100}%`, top: `${(cy / 80) * 100}%` }}
            />
          ))}
        </div>
      </div>
      <div className="mt-2 flex justify-between gap-1 text-xs">
        {MOMENTS.map(({ label }, index) => (
          <button
            key={label}
            type="button"
            onClick={() => select(index)}
            aria-pressed={index === active}
            className={cn(
              "rounded-sm px-1 py-0.5 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-green focus-visible:ring-offset-1",
              index === active ? "font-semibold text-deep-forest" : "text-charcoal-ink/60 hover:text-charcoal-ink"
            )}
          >
            {label}
          </button>
        ))}
      </div>
      <p
        key={active}
        aria-live="polite"
        className="mt-4 text-center text-sm leading-relaxed text-charcoal-ink/70 motion-safe:opacity-0 motion-safe:[animation:marketing-fade-in_0.4s_ease-out_forwards]"
      >
        {MOMENTS[active].detail}
      </p>
    </div>
  );
}
