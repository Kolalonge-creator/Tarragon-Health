import { bpAckWebCode, type BpAckLevel } from "@tarragon/shared";
import { activeWording, t } from "@tarragon/i18n";
import type { BpLevel } from "@/lib/rules/bp-classification";

/**
 * Compile-time guard: the shared acknowledgement band and the web classifier's own band must be the same union. If `classifyBpLevel` ever gains a
 * band, this line stops compiling instead of the new band silently getting no guidance.
 */
type Same<A, B> = [A] extends [B] ? ([B] extends [A] ? true : never) : never;
export const BAND_UNIONS_MATCH: Same<BpLevel, BpAckLevel> = true;

/**
 * What the web shows right after a reading is saved (docs/design/BP-immediate-acknowledgement.md).
 *
 * The web saves online only, so a confirmed save is always "received". A blood pressure reading adds signed wording only where it is true for every
 * adult (see `bpAckWebCode`): a high reading is told to rest and measure again (TRI-005) and a crisis-range reading gets the signed emergency wording
 * (EMG-001). `activeWording` returns the founder-signed text, or the text in force before it, untouched. It never says a person has seen the reading and
 * never promises a time. Other vitals keep the plain line they always had. English only (founder decision: Pidgin removed).
 */
export function vitalSavedMessage(bpAckLevel: BpAckLevel | undefined): string {
  if (!bpAckLevel) return "Reading logged.";
  const base = `${t("bpack.received", "en")} ${t("bpack.received_note", "en")}`;
  const code = bpAckWebCode(bpAckLevel);
  if (!code) return base;
  const w = activeWording(code);
  return `${base} ${w.title}. ${w.body}`;
}
