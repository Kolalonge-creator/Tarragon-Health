"use client";

import { useEffect, useRef, useState } from "react";
import { cn } from "@/lib/utils";

export type ExplorerStep = { title: string; body: string };

/**
 * Interactive numbered "how it works" sequence: every step's full content
 * stays in the DOM (nothing hidden from screen readers or a JS-less render),
 * but clicking a step (or a slow auto-advance, paused the instant someone
 * interacts) highlights it against a progress line, echoing the numbered
 * step patterns on functionhealth.com/superpower.com without hiding content.
 */
export function StepsExplorer({
  steps,
  tone = "green",
  autoAdvanceMs = 3800,
}: {
  steps: ExplorerStep[];
  tone?: "green" | "navy";
  autoAdvanceMs?: number | null;
}) {
  const [active, setActive] = useState(0);
  const interacted = useRef(false);

  useEffect(() => {
    if (autoAdvanceMs == null || steps.length <= 1) return;
    if (typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      return;
    }
    const id = setInterval(() => {
      if (interacted.current) return;
      setActive((a) => (a + 1) % steps.length);
    }, autoAdvanceMs);
    return () => clearInterval(id);
  }, [autoAdvanceMs, steps.length]);

  const activeCircle = tone === "navy" ? "bg-clinical-navy" : "bg-brand-green";
  const activeLine = tone === "navy" ? "bg-clinical-navy" : "bg-brand-green";
  const activeBorder = tone === "navy" ? "border-clinical-navy/30" : "border-brand-green/40";

  return (
    <ol className="mx-auto grid max-w-3xl gap-3">
      {steps.map((item, index) => {
        const isActive = index === active;
        const isPast = index < active;
        return (
          <li key={item.title} className="relative">
            {index < steps.length - 1 ? (
              <span
                aria-hidden
                className={cn(
                  "absolute left-5 top-[3.25rem] h-[calc(100%-2.25rem)] w-px transition-colors duration-500",
                  isPast ? activeLine : "bg-charcoal-ink/10"
                )}
              />
            ) : null}
            <button
              type="button"
              onClick={() => {
                interacted.current = true;
                setActive(index);
              }}
              aria-expanded={isActive}
              className={cn(
                "relative flex w-full gap-4 rounded-xl border bg-white p-5 text-left transition-all duration-300 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-green focus-visible:ring-offset-2 sm:p-6",
                isActive
                  ? cn(activeBorder, "shadow-md")
                  : "border-charcoal-ink/10 hover:border-brand-green/25 hover:shadow-sm"
              )}
            >
              <span
                className={cn(
                  "flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-sm font-semibold transition-colors duration-300",
                  isActive ? cn(activeCircle, "text-white") : "border border-charcoal-ink/15 bg-white text-charcoal-ink/50"
                )}
                aria-hidden
              >
                {index + 1}
              </span>
              <div className="min-w-0">
                <h3
                  className={cn(
                    "font-heading text-lg font-semibold transition-colors duration-300",
                    isActive ? "text-charcoal-ink" : "text-charcoal-ink/75"
                  )}
                >
                  {item.title}
                </h3>
                <p
                  className={cn(
                    "mt-1 text-sm leading-relaxed transition-colors duration-300",
                    isActive ? "text-charcoal-ink/70" : "text-charcoal-ink/50"
                  )}
                >
                  {item.body}
                </p>
              </div>
            </button>
          </li>
        );
      })}
    </ol>
  );
}
