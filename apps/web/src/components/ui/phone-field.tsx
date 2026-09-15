import * as React from "react";
import { cn } from "@/lib/utils";

/**
 * Shared bits for the national-subscriber-number input that sits beside a
 * country-code `<Select>` on the login, signup and forgot-password forms.
 *
 * Two things were wrong with all three, identically:
 *
 *  - no `inputMode`, so a phone raised the full QWERTY keyboard for a field
 *    that only ever takes digits. (`type="tel"` alone does not settle this on
 *    Android; `inputMode="numeric"` is what actually picks the keypad.)
 *  - `placeholder="XXXXXXXXXX"` was the only format hint, and a placeholder
 *    is the wrong place for one: it disappears the moment typing starts, and
 *    several screen readers never announce it at all. Numbers here are stored
 *    E.164 (`+234XXXXXXXXX`, see CLAUDE.md), so the thing a Nigerian user
 *    most needs to be told is to drop the leading zero, which "XXXXXXXXXX"
 *    never said. That now lives in real, always-visible hint text wired to
 *    the input through `aria-describedby`.
 *
 * The placeholder is kept as a shorter shape cue only.
 */
export const PHONE_HINT_ID = "phone-format-hint";

/** Spread onto the `<Input>`; the caller adds className and error props. */
export const phoneInputProps = {
  id: "phone",
  name: "phone",
  type: "tel" as const,
  inputMode: "tel" as const,
  autoComplete: "tel-national" as const,
  placeholder: "8012345678",
  required: true,
};

export function PhoneNumberHint({ className }: { className?: string }) {
  return (
    <p id={PHONE_HINT_ID} className={cn("text-xs text-charcoal-ink/60", className)}>
      Just the number after the country code, with no leading zero. For example 8012345678.
    </p>
  );
}
