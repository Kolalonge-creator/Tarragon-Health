"use client";

import { useState } from "react";
import { cn } from "@/lib/utils";

/**
 * Pausable, auto-scrolling ticker of what the record actually tracks (the
 * functionhealth.com "PAUSE MOTION" pattern). `prefers-reduced-motion` is
 * enforced at the CSS layer regardless of this component's own paused
 * state, so it degrades to a plain wrapped list for anyone whose OS asks
 * for that. Never invents an item: callers pass the real capability list.
 */
export function ConditionsMarquee({ items }: { items: string[] }) {
  const [paused, setPaused] = useState(false);
  const mid = Math.ceil(items.length / 2);
  const rows = [items.slice(0, mid), items.slice(mid)];

  return (
    <div>
      <div className="relative">
        <div
          aria-hidden
          className="pointer-events-none absolute inset-y-0 left-0 z-10 w-10 bg-gradient-to-r from-warm-ivory to-transparent sm:w-16"
        />
        <div
          aria-hidden
          className="pointer-events-none absolute inset-y-0 right-0 z-10 w-10 bg-gradient-to-l from-warm-ivory to-transparent sm:w-16"
        />
        <div className="space-y-3">
          {rows.map((row, rowIndex) =>
            row.length === 0 ? null : (
              <div key={rowIndex} className="overflow-hidden">
                <div
                  className={cn(
                    "flex w-max gap-2",
                    !paused && (rowIndex % 2 === 0 ? "marketing-marquee-left" : "marketing-marquee-right")
                  )}
                  style={{ animationPlayState: paused ? "paused" : "running" }}
                >
                  {[...row, ...row].map((item, itemIndex) => (
                    <span
                      key={`${item}-${itemIndex}`}
                      className="shrink-0 rounded-full border border-charcoal-ink/10 bg-white px-4 py-1.5 text-sm text-charcoal-ink/75"
                    >
                      {item}
                    </span>
                  ))}
                </div>
              </div>
            )
          )}
        </div>
      </div>
      <div className="mt-5 flex justify-center">
        <button
          type="button"
          onClick={() => setPaused((p) => !p)}
          aria-pressed={paused}
          className="rounded-full border border-charcoal-ink/15 bg-white px-4 py-1.5 text-xs font-medium uppercase tracking-wide text-charcoal-ink/55 transition-colors hover:border-brand-green/40 hover:text-charcoal-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-green focus-visible:ring-offset-2"
        >
          {paused ? "Play motion" : "Pause motion"}
        </button>
      </div>
    </div>
  );
}
