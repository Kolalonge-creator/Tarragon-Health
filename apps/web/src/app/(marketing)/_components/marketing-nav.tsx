"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { BrandLockup } from "./brand-logo";
import { MARKETING_ROUTES } from "@/lib/marketing/routes";
import { cn } from "@/lib/utils";

/**
 * Main navigation, redesigned 2026-11-05 (website upgrade Phase 1,
 * docs/plans/website-redesign/00-phase0-plan.md section 3.1). Seven items in
 * the order a first-time visitor needs them, then Log in and Get started.
 * The audience strip that used to sit above the bar is gone: families and
 * employers are now first-class items in the bar itself, and on a phone the
 * strip plus the bar took about a quarter of the first screen.
 *
 * Phase 1 points each item at the page that exists today. Phase 2 and 3 add
 * the dedicated How it works, Membership and Families pages and repoint the
 * three items marked below; nothing else in this file changes then.
 */
export const NAV_LINKS: ReadonlyArray<{ href: string; label: string }> = [
  { href: MARKETING_ROUTES.services, label: "How it works" }, // Phase 2: /how-it-works
  { href: `${MARKETING_ROUTES.home}#services`, label: "Services" },
  { href: MARKETING_ROUTES.pricing, label: "Membership" }, // Phase 2: /membership
  { href: MARKETING_ROUTES.gift, label: "For families" }, // Phase 3: /families
  { href: MARKETING_ROUTES.corporate, label: "For employers" },
  { href: MARKETING_ROUTES.resources, label: "Resources" },
  { href: MARKETING_ROUTES.about, label: "About" },
];

const MOBILE_MENU_ID = "marketing-mobile-menu";

const FOCUS_RING =
  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-green focus-visible:ring-offset-2 focus-visible:ring-offset-mk-canvas";

/** Everything inside the panel that can hold focus, in DOM order. */
function focusableWithin(root: HTMLElement | null): HTMLElement[] {
  if (!root) return [];
  return Array.from(
    root.querySelectorAll<HTMLElement>('a[href], button:not([disabled]), [tabindex]:not([tabindex="-1"])')
  );
}

export function MarketingNav() {
  const [open, setOpen] = useState(false);
  const panelRef = useRef<HTMLElement | null>(null);
  const toggleRef = useRef<HTMLButtonElement | null>(null);

  /** Closing always returns focus to the control that opened the menu. */
  const close = useCallback(() => {
    setOpen(false);
    toggleRef.current?.focus();
  }, []);

  // Escape closes; Tab is trapped inside the open panel (the toggle button is
  // part of the loop, so it stays reachable). Without this, tabbing out of an
  // open full-screen menu lands on links hidden behind the overlay.
  useEffect(() => {
    if (!open) return;

    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        event.preventDefault();
        close();
        return;
      }
      if (event.key !== "Tab") return;

      const toggle = toggleRef.current;
      const items = [...(toggle ? [toggle] : []), ...focusableWithin(panelRef.current)];
      if (items.length === 0) return;

      const first = items[0]!;
      const last = items[items.length - 1]!;
      const active = document.activeElement as HTMLElement | null;

      if (event.shiftKey && (active === first || !active || !items.includes(active))) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && active === last) {
        event.preventDefault();
        first.focus();
      }
    }

    document.addEventListener("keydown", onKeyDown);
    // Lock the page behind the open menu, so a swipe scrolls the menu, not the page.
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      document.body.style.overflow = previousOverflow;
    };
  }, [open, close]);

  return (
    <header className="sticky top-0 z-50 border-b border-mk-border bg-mk-canvas/95 backdrop-blur-sm">
      <div className="mx-auto flex min-h-16 max-w-6xl items-center gap-4 px-4 sm:min-h-[72px] sm:px-6">
        <Link href={MARKETING_ROUTES.home} aria-label="TarragonHealth home" className={cn("shrink-0 rounded-sm", FOCUS_RING)}>
          {/* The wordmark now shows at every width: the old bar hid it below
              `sm` because a pill-shaped bar with three controls overflowed at
              360px. This bar drops the header Get started pill below `sm`
              instead (the hero and the sticky bar carry it), which keeps the
              brand name visible on the phones most visitors use. */}
          <BrandLockup markClassName="h-8 w-8 sm:h-9 sm:w-9" wordmarkClassName="text-base sm:text-lg" />
        </Link>

        <nav aria-label="Main" className="ml-6 hidden items-center gap-6 whitespace-nowrap xl:flex">
          {NAV_LINKS.map(({ href, label }) => (
            <Link
              key={label}
              href={href}
              className={cn("rounded-sm text-[15px] font-medium text-charcoal-ink/80 transition-colors hover:text-brand-green", FOCUS_RING)}
            >
              {label}
            </Link>
          ))}
        </nav>

        <div className="ml-auto flex items-center gap-2 sm:gap-3">
          <Link
            href="/login"
            className={cn("hidden whitespace-nowrap rounded-sm px-1 text-[15px] font-medium text-charcoal-ink hover:text-brand-green sm:inline", FOCUS_RING)}
          >
            Log in
          </Link>
          <Link
            href="/signup"
            className={cn(
              "hidden h-11 shrink-0 items-center justify-center rounded-full bg-brand-green px-5 text-[15px] font-semibold text-white transition-colors hover:bg-brand-green/90 sm:inline-flex",
              FOCUS_RING
            )}
          >
            Get started
          </Link>
          <button
            type="button"
            ref={toggleRef}
            onClick={() => (open ? close() : setOpen(true))}
            aria-expanded={open}
            aria-controls={MOBILE_MENU_ID}
            className={cn(
              "inline-flex h-11 items-center gap-2 rounded-full border border-mk-border bg-white px-4 text-[15px] font-semibold text-charcoal-ink xl:hidden",
              FOCUS_RING
            )}
          >
            <span aria-hidden className="flex w-4 flex-col gap-[3px]">
              <span className={cn("block h-0.5 rounded-full bg-charcoal-ink transition-transform", open && "translate-y-[5px] rotate-45")} />
              <span className={cn("block h-0.5 rounded-full bg-charcoal-ink transition-opacity", open && "opacity-0")} />
              <span className={cn("block h-0.5 rounded-full bg-charcoal-ink transition-transform", open && "-translate-y-[5px] -rotate-45")} />
            </span>
            {open ? "Close" : "Menu"}
          </button>
        </div>
      </div>

      {/* Always in the DOM (just `hidden` when closed) so `aria-controls`
          always resolves; `hidden` also removes it from the tab order. */}
      <nav
        id={MOBILE_MENU_ID}
        ref={panelRef}
        hidden={!open}
        aria-label="Mobile"
        className="max-h-[calc(100dvh-64px)] overflow-y-auto border-t border-mk-border bg-mk-canvas px-4 pb-6 sm:px-6 xl:hidden"
      >
        <ul className="mx-auto max-w-6xl">
          {NAV_LINKS.map(({ href, label }) => (
            <li key={label}>
              <Link
                href={href}
                onClick={() => setOpen(false)}
                className={cn("flex min-h-12 items-center justify-between border-b border-mk-border text-base font-medium text-charcoal-ink", FOCUS_RING)}
              >
                {label}
                <span aria-hidden className="text-brand-green">›</span>
              </Link>
            </li>
          ))}
        </ul>
        <div className="mx-auto mt-5 grid max-w-6xl gap-3">
          <Link
            href="/signup"
            onClick={() => setOpen(false)}
            className={cn("inline-flex h-12 items-center justify-center rounded-full bg-brand-green px-5 text-base font-semibold text-white", FOCUS_RING)}
          >
            Get started
          </Link>
          <Link
            href="/login"
            onClick={() => setOpen(false)}
            className={cn("inline-flex h-12 items-center justify-center rounded-full border border-brand-green px-5 text-base font-semibold text-brand-green", FOCUS_RING)}
          >
            Log in
          </Link>
        </div>
      </nav>
    </header>
  );
}
