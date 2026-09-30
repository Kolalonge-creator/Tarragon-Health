/**
 * Phone normalisation for every sign-in surface (web, mobile, console).
 *
 * Output is always E.164. Nigeria (+234) is the default, because that is who
 * signs up: people type `0803 123 4567`, `803 123 4567`, `2348031234567`,
 * `+234 803 123 4567`, `00234...`, and the common typo `+2340803...` (a stray
 * leading zero after the country code) — all of which must land on the same
 * number, or the verification code goes to a different person than intended.
 *
 * Pure and dependency-free so a client form and a server action cannot
 * disagree. Never logs or throws on user input.
 */
import { E164_GENERIC } from "@tarragon/shared";

export const DEFAULT_COUNTRY_CODE = "+234";

export type PhoneFailureReason = "empty" | "invalid_characters" | "invalid";

export type PhoneNormalisation =
  | { ok: true; e164: string; country: "NG" | "other" }
  | { ok: false; reason: PhoneFailureReason };

/** Nigerian mobile national numbers: 10 digits starting 7, 8 or 9 (070, 080, 081, 090, 091 ...). */
const NG_NATIONAL = /^[789]\d{9}$/;

function ngFromNational(national: string): PhoneNormalisation {
  // One leading zero is the domestic trunk prefix (0803...), also the typo
  // that follows a typed country code (+2340803...). Exactly one is dropped.
  const digits = national.startsWith("0") ? national.slice(1) : national;
  return NG_NATIONAL.test(digits)
    ? { ok: true, e164: `+234${digits}`, country: "NG" }
    : { ok: false, reason: "invalid" };
}

export function normalisePhone(input: string): PhoneNormalisation {
  const trimmed = (input ?? "").trim();
  if (trimmed === "") return { ok: false, reason: "empty" };

  // Spaces, dashes, dots and brackets are formatting, not content.
  let s = trimmed.replace(/[\s\-.()]/g, "");
  if (s.startsWith("00")) s = `+${s.slice(2)}`;

  const hasPlus = s.startsWith("+");
  const digits = hasPlus ? s.slice(1) : s;
  if (!/^\d+$/.test(digits)) return { ok: false, reason: "invalid_characters" };

  if (hasPlus) {
    if (digits.startsWith("234")) return ngFromNational(digits.slice(3));
    return E164_GENERIC.test(`+${digits}`)
      ? { ok: true, e164: `+${digits}`, country: "other" }
      : { ok: false, reason: "invalid" };
  }

  // No plus sign: assume Nigeria, the platform default.
  if (digits.startsWith("234") && digits.length >= 13) return ngFromNational(digits.slice(3));
  if (digits.startsWith("0")) return ngFromNational(digits);
  if (digits.length === 10) return ngFromNational(digits);
  return { ok: false, reason: "invalid" };
}

/**
 * For forms with a separate country-code picker. +234 goes through the
 * Nigerian rules (so a leading zero or a pasted full number still works);
 * any other country is concatenated and checked as generic E.164.
 */
export function normalisePhoneWithCountry(countryCode: string, national: string): PhoneNormalisation {
  // The Nigerian picker is the default, so the national field often already holds a full number ("2348031234567",
  // "+2340803...") or a trunk-prefixed one ("0803..."). normalisePhone reads every one of those on its own; gluing
  // the picker's code on first would double the country code. An explicit "+44..." typed here is honoured as typed.
  if (countryCode === DEFAULT_COUNTRY_CODE) return normalisePhone(national);
  const digits = (national ?? "").replace(/[\s\-.()]/g, "");
  if (digits === "") return { ok: false, reason: "empty" };
  if (!/^\d+$/.test(digits)) return { ok: false, reason: "invalid_characters" };
  const e164 = `${countryCode}${digits}`;
  return E164_GENERIC.test(e164)
    ? { ok: true, e164, country: "other" }
    : { ok: false, reason: "invalid" };
}

/**
 * A display-only mask for "we sent a code to ...". The full number must
 * never reach a log, a Sentry event or a URL; this keeps only the last four
 * digits so the person can still spot a typo.
 */
export function maskPhone(e164: string): string {
  const digits = e164.replace(/\D/g, "");
  if (digits.length < 8) return "***";
  return `+${digits.slice(0, 3)} *** *** ${digits.slice(-4)}`;
}
