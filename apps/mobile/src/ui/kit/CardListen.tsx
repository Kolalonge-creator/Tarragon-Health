import { asLocale } from "@tarragon/i18n";
import { useUiLanguage } from "@/lib/ui-language";
import { ListenButton } from "./ListenButton";

/**
 * "Listen" for the title of a card that explains something (a status, a result, a danger sign, a device state).
 * The card's own words are always on screen and are the text fallback: with no clip recorded (`clipId` null or unknown), or no
 * sound, this renders nothing and the words say everything. It never replaces the words.
 */
export function CardListen({ clipId }: { clipId: string | null | undefined }) {
  const lang = asLocale(useUiLanguage());
  if (!clipId) return null;
  return <ListenButton clipIds={[clipId]} lang={lang} />;
}
