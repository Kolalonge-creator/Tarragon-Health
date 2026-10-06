import { en, t, type Locale } from "@tarragon/i18n";
import { isMessageKey } from "@/lib/commerce/model";

/**
 * What a catalogue item is called on screen. The database holds an i18n key (`catalog_items.name_key`), never a display name, so the
 * label is looked up in the patient's language. A key this build does not know falls back to `fallback`, never the raw key.
 */
export function itemLabel(nameKey: string | null | undefined, fallback: string, locale: Locale = "en"): string {
  return nameKey && isMessageKey(nameKey, en) ? t(nameKey, locale) : fallback;
}
