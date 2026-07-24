"use client";

import { useState } from "react";
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
];

/** Oscar/Omada-style audience split, surfaced above the nav instead of buried in the footer. */
const AUDIENCE_LINKS = [
  { key: "forYou" as const, label: "For individuals" },
  { key: "corporate" as const, label: "For employers" },
  { key: "hmo" as const, label: "For HMOs" },
];

export function MarketingNav() {
  const [open, setOpen] = useState(false);

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
          <div className="flex items-center justify-between gap-4 px-5 py-3 sm:px-6">
            <Link
              href={MARKETING_ROUTES.home}
              aria-label="TarragonHealth home"
              className="focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-green focus-visible:ring-offset-2 rounded-sm"
            >
              <BrandLockup />
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

            <div className="flex items-center gap-2">
              <Link
                href="/login"
                className="hidden text-sm font-medium text-charcoal-ink/70 hover:text-brand-green sm:inline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-green focus-visible:ring-offset-2 rounded-sm px-1"
              >
                Sign in
              </Link>
              <Link
                href="/signup"
                className="hidden h-9 items-center justify-center rounded-full bg-brand-green px-4 text-sm font-medium text-white transition-colors hover:bg-brand-green/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-green focus-visible:ring-offset-2 sm:inline-flex"
              >
                Start monitoring
              </Link>
              <button
                type="button"
                onClick={() => setOpen((v) => !v)}
                aria-label={open ? "Close menu" : "Open menu"}
                aria-expanded={open}
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

          {open ? (
            <nav
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
                Start monitoring
              </Link>
            </nav>
          ) : null}
        </div>
      </header>
    </>
  );
}
