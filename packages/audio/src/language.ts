import { AUDIO_SCRIPTS } from "@tarragon/i18n";
import type { Lang } from "./types";

/** The words of a clip. Empty for an id with no script (a whole number: its text is its digits). */
export function scriptText(clipId: string, lang: Lang): string {
  return AUDIO_SCRIPTS[clipId]?.[lang] ?? "";
}
