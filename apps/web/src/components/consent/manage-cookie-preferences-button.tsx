"use client";

import { Button } from "@/components/ui/button";
import { clearStoredConsent } from "@/lib/consent";

/** Reopens the cookie consent banner so a visitor can change an earlier choice. */
export function ManageCookiePreferencesButton() {
  return (
    <Button variant="outline" size="sm" onClick={() => clearStoredConsent()}>
      Change my cookie preferences
    </Button>
  );
}
