"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { useCookieConsent } from "@/lib/consent";
import { cn } from "@/lib/utils";

/**
 * A persistent "Get started" bar that appears once someone has scrolled past
 * the hero, and hides again near the footer so it never sits on top of the
 * page's own closing CtaBand. Site-wide (mounted once in the marketing
 * layout), not per-page — a scroll-position check rather than
 * IntersectionObserver sentinels, since a layout-level component has no way
 * to know where each page's own hero/footer boundaries fall.
 *
 * Visibility is a plain show/hide, never gated behind
 * prefers-reduced-motion: only the slide transition is skipped for that
 * preference (`motion-reduce:transition-none`), matching the convention
 * already used in staggered-reveal.tsx and marketing-media-frame.tsx.
 *
 * Stays hidden while CookieConsentBanner is still showing (consent === null)
 * — both are fixed to the viewport bottom, and the consent banner has to
 * win that stacking (z-50 vs. this bar's z-40), so showing this bar
 * underneath it would just be an invisible, wasted render.
 */
export function StickyCtaBar() {
  const consent = useCookieConsent();
  const [scrolledIntoRange, setScrolledIntoRange] = useState(false);
  const tickingRef = useRef(false);
  const visible = scrolledIntoRange && consent !== null;

  useEffect(() => {
    const SHOW_AFTER_PX = 480;
    const HIDE_WITHIN_PX_OF_BOTTOM = 560;

    function evaluate() {
      tickingRef.current = false;
      const scrollY = window.scrollY;
      const distanceFromBottom =
        document.documentElement.scrollHeight - (scrollY + window.innerHeight);
      setScrolledIntoRange(scrollY > SHOW_AFTER_PX && distanceFromBottom > HIDE_WITHIN_PX_OF_BOTTOM);
    }

    function onScroll() {
      if (tickingRef.current) return;
      tickingRef.current = true;
      requestAnimationFrame(evaluate);
    }

    evaluate();
    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", onScroll);
    return () => {
      window.removeEventListener("scroll", onScroll);
      window.removeEventListener("resize", onScroll);
    };
  }, []);

  return (
    <div
      aria-hidden={!visible}
      className={cn(
        "fixed inset-x-0 bottom-0 z-40 flex justify-center px-4 pb-4 transition-all duration-300 ease-out motion-reduce:transition-none sm:px-6",
        visible ? "translate-y-0 opacity-100" : "pointer-events-none translate-y-4 opacity-0"
      )}
    >
      <div className="flex w-full max-w-md items-center justify-between gap-4 rounded-full border border-charcoal-ink/10 bg-white/95 p-2 pl-5 shadow-lg shadow-charcoal-ink/15 backdrop-blur">
        <p className="text-sm font-medium text-charcoal-ink">Free to join. Pay only for a doctor&apos;s time.</p>
        <Button asChild size="sm" className="shrink-0" tabIndex={visible ? 0 : -1}>
          <Link href="/signup">Get started</Link>
        </Button>
      </div>
    </div>
  );
}
