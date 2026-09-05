"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { BrandLockup } from "./brand-logo";
import { MARKETING_ROUTES, MARKETING_ROUTES_BUILT } from "@/lib/marketing/routes";
import { cn } from "@/lib/utils";

const NAV_LINKS = [
  { key: "chronicCare" as const, label: "Chronic care" },
  { key: "prevention" as const, label: "Prevention" },
  { key: "careCoordination" as const, label: "Care coordination" },
  { key: "whoItsFor" as const, label: "Who it's for" },
  { key: "pricing" as const, label: "Pricing" },
  // Contact is the only marketing page that captures a lead, and the single
  // route a B2B visitor (employer, HMO) is looking for. It used to exist only
  // in the footer, so reaching it meant scrolling past every page.
  { key: "contact" as const, label: "Contact" },
];

/** Oscar/Omada-style audience split, surfaced above the nav instead of buried in the footer. */
const AUDIENCE_LINKS = [
  { key: "forYou" as const, label: "For individuals" },
  { key: "corporate" as const, label: "For employers" },
  { key: "hmo" as const, label: "For HMOs" },
];

const MOBILE_MENU_ID = "marketing-mobile-menu";

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
  // treated as part of the loop, so the hamburger stays reachable). Without
  // this, tabbing out of an open full-screen menu lands on links that are
  // visually behind the overlay — a keyboard/screen-reader dead end.
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
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [open, close]);

  return (
    <>
      {/* Utility strip: scrolls away, leaving the floating nav bar sticky. */}
      <div className="bg-deep-forest text-white">
        <div className="mx-auto flex max-w-6xl items-center justify-between gap-4 px-4 py-2 sm:px-6">
          <p className="hidden text-xs text-white/70 sm:block">Care that stays with you.</p>
          <nav aria-label="Audiences" className="flex items-center gap-4 text-xs">
            {AUDIENCE_LINKS.map(({ key, label }) => (
              <Link
                key={key}
                href={MARKETING_ROUTES[key]}
                className="text-white/85 transition-colors hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/60 rounded-sm"
              >
                {label}
              </Link>
            ))}
          </nav>
        </div>
      </div>

      <header className="sticky top-0 z-50 px-3 pt-3 sm:px-4">
        <div
          className={cn(
            "mx-auto max-w-6xl border border-charcoal-ink/10 bg-warm-ivory/95 shadow-lg shadow-charcoal-ink/5 backdrop-blur-sm",
            open ? "rounded-3xl" : "rounded-full"
          )}
        >
          <div className="flex items-center justify-between gap-3 px-4 py-3 sm:gap-4 sm:px-6">
            <Link
              href={MARKETING_ROUTES.home}
              aria-label="TarragonHealth home"
              className="focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-green focus-visible:ring-offset-2 rounded-sm"
            >
              {/* Mark only below `sm`. Measured at 360px: the full lockup is
                  ~188px, and the row has ~321px for lockup + CTA + hamburger,
                  so keeping the wordmark here overflowed the bar by ~26px (and
                  far more at 320px) the moment the "Get started" pill became
                  visible on phones. The pill is the point; the Guard Leaf mark
                  carries the brand at that size, and the link keeps its
                  "TarragonHealth home" accessible name either way. */}
              <BrandLockup wordmarkClassName="hidden text-lg sm:inline" />
            </Link>

            <nav aria-label="Main" className="hidden items-center gap-6 lg:flex">
              {NAV_LINKS.map(({ key, label }) => (
                <Link
                  key={key}
                  href={MARKETING_ROUTES[key]}
                  className={cn(
                    "text-sm font-medium text-charcoal-ink/80 transition-colors hover:text-brand-green",
                    "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-green focus-visible:ring-offset-2 rounded-sm",
                    !MARKETING_ROUTES_BUILT.includes(key) && "opacity-50 pointer-events-none"
                  )}
                >
                  {label}
                </Link>
              ))}
            </nav>

            <div className="flex items-center gap-1.5 sm:gap-2">
              <Link
                href="/login"
                className="hidden text-sm font-medium text-charcoal-ink/70 hover:text-brand-green sm:inline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-green focus-visible:ring-offset-2 rounded-sm px-1"
              >
                Sign in
              </Link>
              {/* Visible at every width. Nigeria's traffic is overwhelmingly
                  mobile, and this used to be `hidden … sm:inline-flex`, so on a
                  phone the sticky header offered a hamburger and nothing else:
                  no primary action anywhere above the fold. */}
              <Link
                href="/signup"
                className="inline-flex h-9 shrink-0 items-center justify-center rounded-full bg-brand-green px-3.5 text-sm font-medium text-white transition-colors hover:bg-brand-green/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-green focus-visible:ring-offset-2 sm:px-4"
              >
                Get started
              </Link>
              <button
                type="button"
                ref={toggleRef}
                onClick={() => (open ? close() : setOpen(true))}
                aria-label={open ? "Close menu" : "Open menu"}
                aria-expanded={open}
                aria-controls={MOBILE_MENU_ID}
                className="flex flex-col gap-1.5 p-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-green focus-visible:ring-offset-2 rounded-sm lg:hidden"
              >
                <span
                  className={cn(
                    "block h-0.5 w-5 rounded-full bg-charcoal-ink transition-transform",
                    open && "translate-y-2 rotate-45"
                  )}
                />
                <span
                  className={cn("block h-0.5 w-5 rounded-full bg-charcoal-ink transition-opacity", open && "opacity-0")}
                />
                <span
                  className={cn(
                    "block h-0.5 w-5 rounded-full bg-charcoal-ink transition-transform",
                    open && "-translate-y-2 -rotate-45"
                  )}
                />
              </button>
            </div>
          </div>

          {/* Always in the DOM (just `hidden` when closed) so `aria-controls`
              on the toggle always resolves to a real element; `hidden` also
              takes the whole panel out of the tab order and the a11y tree, so
              nothing behind the closed menu is focusable. */}
          <nav
            id={MOBILE_MENU_ID}
            ref={panelRef}
            hidden={!open}
            aria-label="Mobile"
            className="flex flex-col border-t border-charcoal-ink/10 px-5 pb-5 sm:px-6 lg:hidden"
          >
              {NAV_LINKS.map(({ key, label }) => (
                <Link
                  key={key}
                  href={MARKETING_ROUTES[key]}
                  onClick={() => setOpen(false)}
                  className={cn(
                    "border-b border-charcoal-ink/10 py-3 text-sm font-medium text-charcoal-ink/80",
                    !MARKETING_ROUTES_BUILT.includes(key) && "opacity-50 pointer-events-none"
                  )}
                >
                  {label}
                </Link>
              ))}
              {AUDIENCE_LINKS.map(({ key, label }) => (
                <Link
                  key={key}
                  href={MARKETING_ROUTES[key]}
                  onClick={() => setOpen(false)}
                  className="border-b border-charcoal-ink/10 py-3 text-sm text-charcoal-ink/60"
                >
                  {label}
                </Link>
              ))}
              <Link href="/login" onClick={() => setOpen(false)} className="py-3 text-sm font-medium text-charcoal-ink/80">
                Sign in
              </Link>
              <Link
                href="/signup"
                onClick={() => setOpen(false)}
                className="mt-2 inline-flex h-10 items-center justify-center rounded-full bg-brand-green px-4 text-sm font-medium text-white"
              >
                Get started
              </Link>
          </nav>
        </div>
      </header>
    </>
  );
}
