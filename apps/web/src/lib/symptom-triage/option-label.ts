import { t, type MessageKey } from "@tarragon/i18n";

/** The words for a symptom, trigger or history key from the signed pathway vocabulary. An unknown key reads as its own words, never blank. */
export function symptomOptionLabel(key: string): string {
  const k = `symptom.opt.${key}` as MessageKey;
  const label = t(k) as string | undefined;
  return label === undefined || label === (k as string) ? key.replace(/_/g, " ") : label;
}
