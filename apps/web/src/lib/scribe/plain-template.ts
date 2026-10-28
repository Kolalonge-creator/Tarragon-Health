/**
 * Plain-text fallback for a visit with no transcript and no usable AI (S76-S80): headings the clinician types under, which then go through
 * the same fact-checking path as any pasted notes. Works with no network and no model. Pure.
 */
export const PLAIN_TEMPLATE_HEADINGS = [
  "Reason for visit",
  "History",
  "Examination (what was found)",
  "Assessment",
  "Plan",
  "When to come back or seek help",
] as const;

export function plainNoteTemplate(): string {
  return PLAIN_TEMPLATE_HEADINGS.map((h) => `${h}:\n`).join("\n");
}

/** True when the text is only the template headings with nothing typed under them. */
export function isTemplateEmpty(text: string): boolean {
  const body = PLAIN_TEMPLATE_HEADINGS.reduce((t, h) => t.split(`${h}:`).join(""), text);
  return body.trim() === "";
}
