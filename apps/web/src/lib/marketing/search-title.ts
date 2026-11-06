import type { Metadata } from "next";

/** Roughly what Google shows of a title before cutting it off. */
export const SEARCH_TITLE_MAX = 60;

/** The suffix the marketing layout's title template adds (`%s | TarragonHealth`). */
const TEMPLATE_SUFFIX = " | TarragonHealth";

/**
 * A page title that search engines show in full where possible (website
 * Phase 5, 2026-11-05: the live audit found 35 of 40 article titles over 65
 * characters once the brand suffix was added). Short titles keep the brand
 * suffix; a title that would run past the limit with it drops the suffix
 * instead of being cut mid-word. The article's own heading is unchanged.
 */
export function articleSearchTitle(title: string): Metadata["title"] {
  return title.length + TEMPLATE_SUFFIX.length <= SEARCH_TITLE_MAX ? title : { absolute: title };
}
