/**
 * Shared, dependency-light helpers for the S03b recovery routes (backup codes, recovery contact), used by the web server
 * actions, the mobile API routes and the mobile screens so the three cannot disagree on what a typed identifier or a typed
 * backup code means. Pure: no network, no logging. A code, a number or an address must never reach a log or a URL.
 */
import { normalisePhone } from "./phone";

export type RecoveryIdentifier =
  | { ok: true; kind: "email"; value: string }
  | { ok: true; kind: "phone"; value: string }
  | { ok: false };

const EMAIL_SHAPE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

/**
 * One box for "your email or phone number". An address (contains @) is an email; anything else is read as a phone number
 * the way every other sign-in surface reads it (0803..., 234803..., +234 803...). The result is exactly what Auth stores.
 */
export function classifyRecoveryIdentifier(raw: string): RecoveryIdentifier {
  const text = (raw ?? "").trim();
  if (text === "" || text.length > 254) return { ok: false };
  if (text.includes("@")) {
    return EMAIL_SHAPE.test(text) ? { ok: true, kind: "email", value: text.toLowerCase() } : { ok: false };
  }
  const phone = normalisePhone(text);
  return phone.ok ? { ok: true, kind: "phone", value: phone.e164 } : { ok: false };
}

/** The alphabet the database draws from: 32 symbols, no 0, O, 1 or I. */
const BACKUP_CODE_BODY = /^[A-HJ-NP-Z2-9]{10}$/;

/** "abcde-fghjk", "ABCDE FGHJK" and "abcdefghjk" are all the same code. Returns the 10 symbols, or null when it cannot be one. */
export function normaliseBackupCode(raw: string): string | null {
  const body = (raw ?? "").toUpperCase().replace(/[^A-Z0-9]/g, "");
  return BACKUP_CODE_BODY.test(body) ? body : null;
}

export type PhoneRecoveryHold = { status: "clear" } | { status: "held"; until: string } | { status: "unknown" };

/**
 * Reads the answer of public.my_phone_recovery_hold() (OQ-43: recovery by a text code is paused for a few days after the
 * sign-in number moved). FAIL CLOSED: an error, an empty answer or a held answer with no usable date is "unknown", never "clear",
 * so a broken check can only ever stop a recovery, not wave one through.
 */
export function interpretPhoneRecoveryHold(data: unknown, error: unknown): PhoneRecoveryHold {
  if (error || data === null || typeof data !== "object") return { status: "unknown" };
  const d = data as { held?: unknown; until?: unknown };
  if (d.held === false) return { status: "clear" };
  if (d.held === true) {
    return typeof d.until === "string" && !Number.isNaN(Date.parse(d.until)) ? { status: "held", until: d.until } : { status: "unknown" };
  }
  return { status: "unknown" };
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"] as const;

/** An ISO instant as Lagos wall-clock time, e.g. "16 Oct 2026, 18:30". Lagos is UTC+1 all year (no daylight saving), so no Intl is needed. */
export function formatLagosDateTime(iso: string): string {
  const ms = Date.parse(iso);
  if (Number.isNaN(ms)) return "";
  const d = new Date(ms + 60 * 60 * 1000);
  const two = (n: number) => String(n).padStart(2, "0");
  return `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}, ${two(d.getUTCHours())}:${two(d.getUTCMinutes())}`;
}

/** How a code is shown to the person: XXXXX-XXXXX. */
export function formatBackupCode(body: string): string {
  return body.length === 10 ? `${body.slice(0, 5)}-${body.slice(5)}` : body;
}
