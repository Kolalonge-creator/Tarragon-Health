"use client";

import { useEffect, useRef, useState } from "react";

const SINGLE_NUMBER = /^(\D*)(\d+(?:[.,]\d+)?)(\D*)$/;

/**
 * Counts a single-number stat up from 0 when it scrolls into view (the
 * functionhealth.com/superpower.com stat-tile treatment). Only real,
 * already-authored values are ever passed in; this never fabricates a
 * number, it just animates toward the exact string the caller provided.
 * Anything that isn't a clean "prefix + one number + suffix" shape (e.g.
 * "124 / 79") renders as plain text, unchanged.
 */
export function AnimatedNumber({ value, durationMs = 900 }: { value: string; durationMs?: number }) {
  const match = SINGLE_NUMBER.exec(value.trim());
  const ref = useRef<HTMLSpanElement>(null);
  const startedRef = useRef(false);
  const [display, setDisplay] = useState(() => (match ? `${match[1]}0${match[3]}` : value));

  useEffect(() => {
    if (!match) return;
    const node = ref.current;
    if (!node) return;

    const [, prefix, digits, suffix] = match;
    const target = parseFloat(digits.replace(/,/g, ""));
    const isInteger = !digits.includes(".");
    const reducedMotion =
      typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

    const animate = () => {
      if (startedRef.current) return;
      startedRef.current = true;

      if (reducedMotion) {
        setDisplay(value);
        return;
      }

      const start = performance.now();
      const tick = (now: number) => {
        const progress = Math.min(1, (now - start) / durationMs);
        const eased = 1 - Math.pow(1 - progress, 3);
        const current = target * eased;
        const formatted = isInteger
          ? Math.round(current).toLocaleString()
          : current.toFixed(digits.split(".")[1]?.length ?? 1);
        setDisplay(`${prefix}${formatted}${suffix}`);
        if (progress < 1) requestAnimationFrame(tick);
      };
      requestAnimationFrame(tick);
    };

    const observer = new IntersectionObserver(
      ([entry]) => {
        if (!entry.isIntersecting) return;
        animate();
        observer.disconnect();
      },
      { threshold: 0.4 }
    );
    observer.observe(node);

    // Safety net: a handful of environments (backgrounded/hidden documents,
    // browsers that throttle IntersectionObserver indefinitely) never fire
    // the callback at all. A stat must never be stuck at 0 forever because
    // of that, so fall through to the real value once, un-animated.
    const fallback = window.setTimeout(() => {
      if (!startedRef.current) {
        startedRef.current = true;
        setDisplay(value);
      }
    }, 2500);

    return () => {
      observer.disconnect();
      window.clearTimeout(fallback);
    };
  }, [match, value, durationMs]);

  if (!match) return <span>{value}</span>;
  return <span ref={ref}>{display}</span>;
}
