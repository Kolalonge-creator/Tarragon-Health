"use client";

import { clearStoredConsent } from "@/lib/consent";

/** Footer "Cookie settings": clears the stored choice so the consent banner asks again. */
export function CookieSettingsLink({ className }: { className?: string }) {
  return (
    <button type="button" onClick={() => clearStoredConsent()} className={className}>
      Cookie settings
    </button>
  );
}
