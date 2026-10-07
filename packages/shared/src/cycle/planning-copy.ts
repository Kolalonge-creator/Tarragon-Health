import { FERTILE_WINDOW_DISCLAIMER, NOT_CONTRACEPTION_LABEL, type CyclePrediction } from "./prediction";

/**
 * Wording and helpers for "planning a pregnancy" mode (S66, decisions A14 and 16.2).
 *
 * The rules this file exists to hold in one place:
 *  1. The fertile window is shown ONLY while the patient has switched the mode on. It is off by default.
 *  2. Every line that states a window carries "This is not contraception." (built in here, so a screen cannot forget it).
 *  3. Wording says "estimate". Never "safe days", never anything about avoiding a pregnancy.
 *  4. No push, email or in-app preview ever mentions a fertile day (see FERTILITY_WORDS and mentionsFertility, used by the INV-07 lint).
 *
 * All strings here are PROPOSED copy awaiting CMO review (docs/design/S66.md section 6).
 */

export const PLANNING_MODE_COPY = {
  title: "Planning a pregnancy",
  description:
    "Turn this on only if you are trying to conceive. It adds an estimated fertile window and an ovulation test log to your tracker. It stays off unless you switch it on, and you can switch it off any time.",
  onLabel: "Planning mode is on",
  offLabel: "Planning mode is off",
  notContraception: NOT_CONTRACEPTION_LABEL,
  disclaimer: FERTILE_WINDOW_DISCLAIMER,
  offNote: "Your estimated fertile days are hidden while planning mode is off.",
  turnOffNote:
    "Switching it off hides the estimate from every screen and export. Your logged days stay exactly as they are.",
} as const;

/** Words that mean a fertile day is being talked about. Lower case stems. Used by the notification lint and by tests. */
export const FERTILITY_WORDS: readonly string[] = ["fertile", "fertility", "ovulat", "conceiv", "conception", "trying to"];

export function mentionsFertility(text: string): boolean {
  const lower = text.toLowerCase();
  return FERTILITY_WORDS.some((w) => lower.includes(w));
}

/** True when the text carries the not-contraception label. */
export function hasNotContraceptionLabel(text: string): boolean {
  return text.includes(NOT_CONTRACEPTION_LABEL);
}

/**
 * The one way a surface turns a prediction into a window line. Returns null when there is no window (planning mode off, or not enough
 * history), so a caller that renders a window can only do so through this function and so always gets the label.
 */
export function describeFertileWindow(
  prediction: Pick<CyclePrediction, "fertileWindowStart" | "fertileWindowEnd">,
  formatDate: (isoDate: string) => string,
): string | null {
  if (!prediction.fertileWindowStart || !prediction.fertileWindowEnd) return null;
  return `Estimated fertile window ${formatDate(prediction.fertileWindowStart)} to ${formatDate(prediction.fertileWindowEnd)}. ${NOT_CONTRACEPTION_LABEL}`;
}

/** Footer for any export or printout that includes a window. */
export const EXPORT_NOT_CONTRACEPTION_FOOTER = `${NOT_CONTRACEPTION_LABEL} Any fertile-window figure in this document is a calendar estimate and must not be used to avoid or to plan around a pregnancy.`;
