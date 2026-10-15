import { cycleCopy } from "@tarragon/i18n";

/**
 * The contraception methods shown on the education page, taken from the catalogue in the order it holds them. That order is alphabetical
 * by method name, and a test in packages/i18n keeps it that way, so the page cannot read as a ranking.
 */
export const CONTRACEPTION_METHOD_KEYS = (Object.keys(cycleCopy) as (keyof typeof cycleCopy)[]).filter((k) => k.startsWith("contraception.edu.method."));
