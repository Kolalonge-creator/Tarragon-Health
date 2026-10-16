import { bpAckWebCode, type BpAckLevel } from "@tarragon/shared";
import { activeWording, t } from "@tarragon/i18n";

/**
 * What the web shows right after a reading is saved (docs/design/BP-immediate-acknowledgement.md).
 *
 * The web saves online only, so a saved reading is always "received". A blood pressure reading adds the signed wording for its band
 * (EMG/TRI, untouched: `activeWording` returns the founder-signed text, or the text in force before it). It never says a person has seen the
 * reading and never promises a time. Other vitals keep the plain line they always had.
 */
export function vitalSavedMessage(bpAckLevel: BpAckLevel | undefined): string {
  if (!bpAckLevel) return "Reading logged.";
  const base = `${t("bpack.received", "en")} ${t("bpack.received_note", "en")}`;
  const code = bpAckWebCode(bpAckLevel);
  if (!code) return base;
  const w = activeWording(code);
  return `${base} ${w.title}. ${w.body}`;
}
