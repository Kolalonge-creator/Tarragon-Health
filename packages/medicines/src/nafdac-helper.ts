/**
 * NAFDAC verification helper (item 14). Behind the go-live guard `nafdac_verify_helper_enabled` (OFF).
 *
 * Tarragon sends nothing and receives nothing. The helper only (a) links to NAFDAC's public registration check and (b) opens the
 * person's own messaging app with the scratch code typed in, so THEY send it from their own phone. INV-08 limits SMS that Tarragon
 * sends; whether this is acceptable is the founder's call (OQ-NAFDAC-HELPER-1).
 *
 * The short code is UNVERIFIED. 38353 comes from 2010-era sources and must be re-verified with NAFDAC before the guard is switched on.
 * A registration match is not proof that a pack is genuine.
 */
export interface NafdacHelperConfig {
  registrationCheck: { name: string; url: string; readOn: string };
  mas: { shortCode: string; verified: boolean; source: string; codeDigits: number };
}

export const NAFDAC_HELPER_CONFIG: NafdacHelperConfig = {
  registrationCheck: { name: "NAFDAC Greenbook", url: "https://greenbook.nafdac.gov.ng", readOn: "2026-10-22" },
  mas: { shortCode: "38353", verified: false, source: "2010-era press and Mondaq; not confirmed with NAFDAC", codeDigits: 12 },
};

/** The digits of a scratch code as typed (spaces and dashes allowed), or null when it is not exactly the expected number of digits. */
export function normaliseScratchCode(raw: string, cfg: NafdacHelperConfig = NAFDAC_HELPER_CONFIG): string | null {
  const digits = raw.replace(/[\s-]/g, "");
  return new RegExp(`^[0-9]{${cfg.mas.codeDigits}}$`).test(digits) ? digits : null;
}

export type MessageLink = { ok: true; uri: string; unverified: boolean } | { ok: false; reason: "bad_code" };

/** `sms:<short code>?&body=<code>`: the form both iPhone and Android messaging apps accept. It opens the app; the person presses send. */
export function scratchCodeMessageLink(raw: string, cfg: NafdacHelperConfig = NAFDAC_HELPER_CONFIG): MessageLink {
  const code = normaliseScratchCode(raw, cfg);
  if (code === null) return { ok: false, reason: "bad_code" };
  return { ok: true, uri: `sms:${cfg.mas.shortCode}?&body=${encodeURIComponent(code)}`, unverified: !cfg.mas.verified };
}

/** The helper shows only while its guard is open. A guard that could not be read keeps it hidden. */
export function nafdacHelperVisible(guardState: "open" | "closed" | "unknown"): boolean {
  return guardState === "open";
}
