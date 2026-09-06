"use client";

import { useEffect, useRef, useState } from "react";
import { cn } from "@/lib/utils";

/**
 * A genuinely orchestrated scroll reveal: children appear one after another
 * on a shared timeline, not simultaneously — unlike every other marketing
 * section, which relies on globals.css's `.marketing-reveal` (a per-element
 * `animation-timeline: view()` fade that treats each section as independent).
 * That per-section fade is fine as a baseline everywhere; this component is
 * for the one or two spots per page that should read as a deliberate
 * sequence rather than another box appearing.
 *
 * IntersectionObserver + CSS transition-delay, not `animation-timeline:
 * view()`, because Safari didn't support scroll-driven animations until
 * 18.2 (mid-2025) — this needs to work everywhere today, not just on
 * browsers with the newest CSS. Fires once; never re-hides on scroll-away,
 * so the sequence plays exactly once per visit.
 *
 * `visible` always starts `false` (SSR-safe — no `window` read in the
 * initializer, so server and client render identically) and the reduced-
 * motion override lives entirely in the `motion-reduce:` classes below,
 * matching the CSS-only approach already used elsewhere on this site
 * (globals.css, marketing-media-frame.tsx's `motion-safe:opacity-0`) rather
 * than duplicating a JS matchMedia check here.
 */
export function StaggeredReveal({
  children,
  className,
  staggerMs = 90,
}: {
  children: React.ReactNode[];
  className?: string;
  /** Delay between each child's reveal, in milliseconds. */
  staggerMs?: number;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const node = ref.current;
    if (!node) return;
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          setVisible(true);
          observer.disconnect();
        }
      },
      { threshold: 0.15 }
    );
    observer.observe(node);
    return () => observer.disconnect();
  }, []);

  return (
    <div ref={ref} className={className}>
      {children.map((child, index) => (
        <div
          key={index}
          className={cn(
            "transition-all duration-500 ease-out motion-reduce:transition-none motion-reduce:translate-y-0 motion-reduce:opacity-100",
            visible ? "translate-y-0 opacity-100" : "translate-y-4 opacity-0"
          )}
          style={{ transitionDelay: `${index * staggerMs}ms` }}
        >
          {child}
        </div>
      ))}
    </div>
  );
}
