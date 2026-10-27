import { z } from "zod";
import { classifyPlausibility, type ImpossibleReason } from "@tarragon/shared";

/**
 * Turns what a vision model said it saw on a blood pressure cuff display into a PROPOSAL, or refuses it. Pure and deterministic: no model,
 * no clock, no network (INV-01). Nothing here saves anything and nothing here triages anything: a proposal is three numbers for the person to
 * look at beside their photo and tick one by one (S70a `finalisePhotoReading` is the only way they become a reading).
 *
 * Refusals are for the person to retake the photo, never a guess:
 *  - "unreadable": the model could not see a display, or reported low confidence.
 *  - "implausible": a number outside the physiological ranges in `devices.plausibility`, or a top number that is not above the bottom one.
 *    The ranges come from the one config the database trigger also uses, so the app and the database never disagree about "impossible".
 *  - "incomplete": the top or bottom number is missing. A half-read pair is never offered.
 * Pulse is optional: a missing or implausible pulse is dropped and the person types it, because a wrong pulse must not sink a good pair.
 */
export const cuffModelOutputSchema = z.object({
  /** True only when a blood pressure monitor display is actually visible in the photo. */
  display_visible: z.boolean(),
  systolic: z.number().int().nullable(),
  diastolic: z.number().int().nullable(),
  pulse: z.number().int().nullable(),
  confidence: z.enum(["low", "medium", "high"]),
  /** Short note when something is wrong with the photo (glare, cut off, blurred). Never shown as a number. */
  note: z.string().max(200).nullable(),
});
export type CuffModelOutput = z.infer<typeof cuffModelOutputSchema>;

export type CuffRefusalReason = "unreadable" | "implausible" | "incomplete";

export type CuffProposal =
  | { ok: true; systolic: number; diastolic: number; pulse: number | null; confidence: "medium" | "high"; pulseDropped: boolean }
  | { ok: false; reason: CuffRefusalReason; impossible: ImpossibleReason[] };

export function normaliseCuffProposal(raw: unknown): CuffProposal {
  const parsed = cuffModelOutputSchema.safeParse(raw);
  if (!parsed.success) return { ok: false, reason: "unreadable", impossible: [] };
  const m = parsed.data;
  if (!m.display_visible || m.confidence === "low") return { ok: false, reason: "unreadable", impossible: [] };
  if (m.systolic === null || m.diastolic === null) return { ok: false, reason: "incomplete", impossible: [] };

  const pair = classifyPlausibility({ vitalType: "blood_pressure", systolic: m.systolic, diastolic: m.diastolic, pulseBpm: null });
  if (pair.class === "impossible") return { ok: false, reason: "implausible", impossible: pair.reasons };

  let pulse: number | null = null;
  let pulseDropped = false;
  if (m.pulse !== null) {
    const p = classifyPlausibility({ vitalType: "pulse", pulseBpm: m.pulse });
    if (p.class === "ok") pulse = m.pulse;
    else pulseDropped = true;
  }
  return { ok: true, systolic: m.systolic, diastolic: m.diastolic, pulse, confidence: m.confidence, pulseDropped };
}

/**
 * The lines the phone feeds to `draftFromRecognisedText`, in reading order (top, bottom, pulse). Going through that one function means a
 * proposal gets the same editable boxes, the same "top should be bigger" warning and the same confirm gate as any recogniser's output.
 */
export function proposalToRecognisedLines(p: Extract<CuffProposal, { ok: true }>): string[] {
  return [String(p.systolic), String(p.diastolic), ...(p.pulse !== null ? [String(p.pulse)] : [])];
}
