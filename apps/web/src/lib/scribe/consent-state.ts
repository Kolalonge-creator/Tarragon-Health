import { z } from "zod";
import type { MessageKey } from "@tarragon/i18n";

/**
 * The patient's own in-app answer to "may the AI note-taker be used", read for the clinician's screen (S21 and S35c).
 * The clinician cannot answer for the patient: the database refuses a granted consent without the patient's answer.
 * Three states, never a boolean: not asked is not the same as declined, and neither is "given".
 */
export const consentStateSchema = z.object({
  state: z.enum(["no_consultation", "not_asked", "given", "declined"]),
  encounter_id: z.string().uuid().optional(),
  live: z.boolean().optional(),
  may_start: z.boolean().optional(),
});
export type ConsentState = z.infer<typeof consentStateSchema>;

export type ConsentView =
  | { kind: "can_start" }
  | { kind: "blocked"; messageKey: MessageKey };

/** What the panel shows. Starting needs the patient's yes AND a live consultation with the feature switched on. */
export function consentView(s: ConsentState): ConsentView {
  switch (s.state) {
    case "no_consultation":
      return { kind: "blocked", messageKey: "scribe.gate.no_consultation" };
    case "not_asked":
      return { kind: "blocked", messageKey: "scribe.gate.not_asked" };
    case "declined":
      return { kind: "blocked", messageKey: "scribe.gate.declined" };
    case "given":
      return s.may_start === true ? { kind: "can_start" } : { kind: "blocked", messageKey: "scribe.gate.not_available_now" };
  }
}
