/**
 * One date format, stated explicitly, used everywhere the passport is shown.
 *
 * Two separate reasons, both real:
 *
 *   HYDRATION. `toLocaleDateString()` with no locale resolves against whatever
 *   locale the runtime happens to have. The server and the browser frequently
 *   disagree, React notices the rendered text differs, and the whole subtree is
 *   thrown away and re-rendered client-side. That is exactly the bug this
 *   module was written to fix, caught in the browser on the attestation
 *   worklist, and it is invisible in a unit test.
 *
 *   AMBIGUITY. 03/04/2026 means two different days depending on whether the
 *   reader is Nigerian, British or American. A Health Passport is built to be
 *   read across precisely those borders, so a spelled-out month is not a style
 *   preference — it is the difference between a date and a guess. The PDF uses
 *   the same convention (see health-passport-document.tsx), so the screen and
 *   the document can never show a date two different ways.
 */

const OPTIONS: Intl.DateTimeFormatOptions = {
  day: "numeric",
  month: "short",
  year: "numeric",
};

const LONG_OPTIONS: Intl.DateTimeFormatOptions = {
  day: "numeric",
  month: "long",
  year: "numeric",
};

export function formatPassportDate(value: string | null | undefined): string {
  if (!value) return "Not recorded";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Not recorded";
  return date.toLocaleDateString("en-GB", OPTIONS);
}

/** The fuller form, for the small number of places a date carries real weight. */
export function formatPassportDateLong(value: string | null | undefined): string {
  if (!value) return "Not recorded";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Not recorded";
  return date.toLocaleDateString("en-GB", LONG_OPTIONS);
}

export function formatPassportPeriod(start: string, end: string): string {
  return `${formatPassportDate(start)} to ${formatPassportDate(end)}`;
}
