"use client";

import { useEffect, useState } from "react";
import { cn } from "@/lib/utils";

export type MarketingTestimonial = { id: string; display_name: string; quote: string };

/**
 * Swipeable/auto-advancing testimonial slider (the superpower.com member-
 * story pattern), fed only real, published, consented quotes from the
 * caller. Pauses on hover/focus and on any manual navigation; a single
 * testimonial just renders statically with no carousel chrome.
 */
export function TestimonialsCarousel({ items }: { items: MarketingTestimonial[] }) {
  const [index, setIndex] = useState(0);
  const [paused, setPaused] = useState(false);
  const count = items.length;

  useEffect(() => {
    if (count <= 1 || paused) return;
    if (typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      return;
    }
    const id = setInterval(() => setIndex((i) => (i + 1) % count), 6500);
    return () => clearInterval(id);
  }, [count, paused]);

  if (count === 0) return null;

  const current = items[index];

  const go = (next: number) => {
    setPaused(true);
    setIndex(((next % count) + count) % count);
  };

  return (
    <div
      className="mx-auto max-w-3xl"
      onMouseEnter={() => setPaused(true)}
      onMouseLeave={() => setPaused(false)}
      onFocus={() => setPaused(true)}
      onBlur={() => setPaused(false)}
    >
      <div
        aria-live="polite"
        className="rounded-xl bg-warm-ivory p-8 text-center shadow-sm motion-safe:transition-opacity sm:p-10"
      >
        <figure key={current.id}>
          <blockquote className="font-heading text-xl leading-relaxed text-charcoal-ink sm:text-2xl">
            &ldquo;{current.quote}&rdquo;
          </blockquote>
          <figcaption className="mt-5 text-sm font-medium text-charcoal-ink/70">
            {current.display_name}
          </figcaption>
        </figure>
      </div>

      {count > 1 ? (
        <div className="mt-6 flex items-center justify-center gap-4">
          <button
            type="button"
            aria-label="Previous testimonial"
            onClick={() => go(index - 1)}
            className="flex h-9 w-9 items-center justify-center rounded-full border border-charcoal-ink/15 text-lg text-charcoal-ink/60 transition-colors hover:border-brand-green/40 hover:text-charcoal-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-green focus-visible:ring-offset-2"
          >
            ‹
          </button>
          <div className="flex gap-2">
            {items.map((t, i) => (
              <button
                key={t.id}
                type="button"
                aria-label={`Show testimonial ${i + 1} of ${count}`}
                aria-current={i === index}
                onClick={() => go(i)}
                className={cn(
                  "h-2 rounded-full transition-all duration-300",
                  i === index ? "w-6 bg-brand-green" : "w-2 bg-charcoal-ink/20 hover:bg-charcoal-ink/40"
                )}
              />
            ))}
          </div>
          <button
            type="button"
            aria-label="Next testimonial"
            onClick={() => go(index + 1)}
            className="flex h-9 w-9 items-center justify-center rounded-full border border-charcoal-ink/15 text-lg text-charcoal-ink/60 transition-colors hover:border-brand-green/40 hover:text-charcoal-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-green focus-visible:ring-offset-2"
          >
            ›
          </button>
        </div>
      ) : null}
    </div>
  );
}
