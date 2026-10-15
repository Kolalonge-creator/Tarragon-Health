import { maskPhone } from "@tarragon/auth/phone";

/** The slice of an Auth user these decisions read. */
export interface PhoneChangeUser {
  phone?: string | null;
  phone_confirmed_at?: string | null;
  email?: string | null;
  email_confirmed_at?: string | null;
}

export interface PhoneChangeOptions {
  /** True when the account has a confirmed phone or a confirmed email: then the owner must prove control of one before the number can change. */
  needsConfirmation: boolean;
  /** A code can go to the current number (it must be confirmed). */
  oldPhone: { masked: string } | null;
  /** A code can go to the verified email. */
  email: { masked: string } | null;
}

export function e164FromAuthPhone(phone: string): string {
  return phone.startsWith("+") ? phone : `+${phone}`;
}

function maskEmail(email: string): string {
  const [local = "", domain = ""] = email.split("@");
  return `${local.slice(0, 1)}***@${domain}`;
}

/**
 * Which ways exist to confirm a number change for this account. Mirrors the database gate
 * (private.enforce_phone_change_authorisation): an account with nothing confirmed has nothing to confirm with and is not blocked.
 */
export function phoneChangeOptions(user: PhoneChangeUser): PhoneChangeOptions {
  const oldPhone = user.phone && user.phone_confirmed_at ? { masked: maskPhone(e164FromAuthPhone(user.phone)) } : null;
  const email = user.email && user.email_confirmed_at ? { masked: maskEmail(user.email) } : null;
  return { needsConfirmation: Boolean(oldPhone || email), oldPhone, email };
}
