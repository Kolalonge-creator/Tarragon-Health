/**
 * Reading an amount a person typed into a finance form.
 *
 * This replaces `majorToMinor`, which was `parseFloat` with every failure
 * turned into 0. That read "1,500,000" as 1 (parseFloat stops at the comma),
 * so a ₦1,500,000 journal line was stored as ₦1.00, and read "abc" and "₦5000"
 * as 0, which dropped a typed line from a journal entry without a word. A
 * ledger cannot be allowed to guess. An amount is either read exactly as it was
 * typed, or refused with a reason.
 *
 * Accepted: digits, thousands commas in groups of three, an optional dot with
 * one or two decimals, and an optional leading currency symbol. Everything else
 * is refused, including negatives, more than two decimals (which would round
 * half a kobo away), and a bare "5 000" or "1,50" (ambiguous between thousands
 * and decimals).
 *
 * The result is built from the digits, not from floating point, so ₦0.29 is 29
 * kobo and not 28.999999.
 *
 * It is the one way to read a typed amount: the admin earnings and employer screens, payer claims, provider
 * organisation and partner settlement forms all use it, and the looser `nairaInputToKobo` it replaced has been
 * removed. A typo is refused with a reason rather than guessed at.
 */

export type MoneyParse = { ok: true; minor: number } | { ok: false; error: string };

const SYMBOLS = /^[₦$£€]\s*/;
const SHAPE = /^(?:\d{1,3}(?:,\d{3})+|\d+)?(?:\.\d+)?$/;

function refuse(raw: string, why: string): MoneyParse {
  return { ok: false, error: `"${raw.trim()}" ${why}` };
}

export interface ParseMoneyOptions {
  /** Accept 0. Default true. A threshold or a price that must be above zero passes false. */
  allowZero?: boolean;
}

/** Read one amount. A blank field is refused here: use parseOptionalMoney where blank means "none". */
export function parseMoneyInput(raw: string | number, options: ParseMoneyOptions = {}): MoneyParse {
  const allowZero = options.allowZero ?? true;

  if (typeof raw === "number") {
    if (!Number.isFinite(raw) || raw < 0) return { ok: false, error: "Enter an amount of zero or more." };
    return parseMoneyInput(String(raw), options);
  }

  const text = raw.trim().replace(SYMBOLS, "");
  if (text === "") return { ok: false, error: "Enter an amount." };
  if (text.startsWith("-")) return refuse(raw, "is negative. Enter the amount without a minus sign.");
  if (!SHAPE.test(text) || !/\d/.test(text)) {
    return refuse(raw, "is not an amount. Use digits, a comma between thousands and a dot for decimals, for example 1,500,000.50.");
  }

  const [whole = "", fraction = ""] = text.replace(/,/g, "").split(".");
  if (fraction.length > 2) return refuse(raw, "has more than two decimal places.");

  // Whole and cents are joined as digits, so no float arithmetic is involved (INV-15).
  const minor = Number(`${whole === "" ? "0" : whole}${fraction.padEnd(2, "0")}`);
  if (!Number.isSafeInteger(minor)) return refuse(raw, "is too large.");
  if (minor === 0 && !allowZero) return { ok: false, error: "The amount must be more than zero." };

  return { ok: true, minor };
}

export type OptionalMoneyParse = { ok: true; minor: number | null } | { ok: false; error: string };

/** For a field where leaving it empty is allowed and means "no amount". A filled-in value is read as strictly as parseMoneyInput. */
export function parseOptionalMoney(raw: string, options: ParseMoneyOptions = {}): OptionalMoneyParse {
  if (raw.trim() === "") return { ok: true, minor: null };
  const parsed = parseMoneyInput(raw, options);
  return parsed.ok ? { ok: true, minor: parsed.minor } : parsed;
}
