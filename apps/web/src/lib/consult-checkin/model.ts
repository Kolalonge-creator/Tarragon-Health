import { z } from "zod";

/**
 * PCC: the shapes the post-consultation check-in functions return, parsed with Zod so a changed database shape is a visible error and never a
 * silently empty screen. The wording comes from the signed configuration the check-in was created with (it is returned by
 * `my_post_consult_checkin`); nothing in the web app invents a question.
 */
export const checkinViewSchema = z.object({
  id: z.string().uuid(),
  state: z.enum(["scheduled", "open", "answered", "expired", "cancelled"]),
  offset_code: z.string(),
  due_at: z.string(),
  title: z.string(),
  intro: z.string(),
  free_text_max_chars: z.number().int().positive(),
  questions: z
    .array(
      z.object({
        id: z.string(),
        text: z.string(),
        options: z.array(z.object({ code: z.string(), label: z.string() })).min(2),
      }),
    )
    .min(1),
  outcome: z
    .object({ red_flag: z.boolean(), concern: z.boolean(), follow_up: z.boolean(), alert_raised: z.boolean().optional() })
    .nullable(),
});
export type CheckinView = z.infer<typeof checkinViewSchema>;

export const checkinOutcomeSchema = z.object({
  red_flag: z.boolean(),
  concern: z.boolean(),
  follow_up: z.boolean(),
  alert_raised: z.boolean().optional(),
});
export type CheckinOutcome = z.infer<typeof checkinOutcomeSchema>;

export const answerInputSchema = z.object({
  checkinId: z.string().uuid(),
  answers: z.record(z.string().min(1).max(40), z.string().min(1).max(40)),
  note: z.string().max(2000).optional(),
});

/** True when every question has an answer: the form enables Send only then (the database checks it again). */
export function allAnswered(view: Pick<CheckinView, "questions">, answers: Readonly<Record<string, string>>): boolean {
  return view.questions.every((q) => q.options.some((o) => o.code === answers[q.id]));
}

export const clinicianCheckinsSchema = z.array(
  z.object({
    id: z.string().uuid(),
    offset_code: z.string(),
    state: z.string(),
    due_at: z.string(),
    answered_at: z.string().nullable(),
    red_flag: z.boolean(),
    concern: z.boolean().optional(),
    answers: z.array(z.object({ question: z.string(), answer: z.string().nullable() })).nullable(),
    free_text: z.string().nullable(),
  }),
);
export type ClinicianCheckin = z.infer<typeof clinicianCheckinsSchema>[number];

/** "48 hours" and "7 days" for the clinician card; an unknown code is shown as it is rather than guessed. */
export function offsetLabel(code: string): string {
  if (code === "h48") return "48 hour check-in";
  if (code === "d7") return "7 day check-in";
  return `${code} check-in`;
}
