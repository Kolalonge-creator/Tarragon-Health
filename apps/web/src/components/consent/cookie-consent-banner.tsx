"use client";

import { usePathname } from "next/navigation";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { setStoredConsent, useCookieConsent, type CookieConsentChoice } from "@/lib/consent";
import { isMarketingPath } from "@/lib/marketing/routes";

/**
 * Shown only on the public marketing site (never inside the signed-in app,
 * where the same anonymous analytics is a disclosed, in-Terms part of
 * running the product rather than an anonymous-visitor tracking notice).
 * Stays hidden once a choice is stored; reopens only via "Change my cookie
 * preferences" on the Cookie Policy page, which clears the stored choice.
 *
 * Opt-in (founder decision W-07, 2026-11-05): on the public site analytics
 * sends nothing until "Accept" is pressed, so this banner is a real gate.
 * Both choices carry equal visual weight, and the banner is kept to two
 * lines on a phone (the live audit found it covering a fifth of the screen).
 */
export function CookieConsentBanner() {
  const pathname = usePathname();
  const consent = useCookieConsent();

  if (!isMarketingPath(pathname)) return null;
  if (consent !== null) return null;

  const choose = (choice: CookieConsentChoice) => {
    setStoredConsent(choice);
  };

  return (
    <div
      role="region"
      aria-label="Cookie consent"
      className="marketing-scope fixed inset-x-0 bottom-0 z-50 border-t border-mk-border bg-white px-4 py-3 shadow-[0_-4px_24px_rgba(20,35,30,0.12)] sm:px-6 sm:py-4"
    >
      {/* Kept short on purpose: on a phone this banner sits over the hero,
          so every extra line here is a line of the page a visitor cannot
          see. The full reasoning lives on the Cookie Policy page. */}
      <div className="mx-auto flex max-w-5xl flex-col gap-2 sm:flex-row sm:items-center sm:justify-between sm:gap-6">
        <p className="text-sm leading-relaxed text-charcoal-ink/80">
          May we count your visit? Anonymous analytics only, no ads.{" "}
          <Link href="/cookies" className="underline hover:text-deep-forest">
            Cookie Policy
          </Link>
        </p>
        <div className="flex shrink-0 gap-2 sm:gap-3">
          <Button variant="outline" size="sm" className="flex-1 sm:flex-none" onClick={() => choose("rejected")}>
            No, thanks
          </Button>
          <Button variant="outline" size="sm" className="flex-1 sm:flex-none" onClick={() => choose("accepted")}>
            Accept
          </Button>
        </div>
      </div>
    </div>
  );
}
