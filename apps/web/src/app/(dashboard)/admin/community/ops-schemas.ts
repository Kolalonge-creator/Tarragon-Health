import { z } from "zod";

/**
 * Input rules for the rota, pictures and doctor question session forms. The limits equal the database limits in
 * 20261009213122_community_images_ops_qa.sql; the database still checks them again.
 */
const uuid = z.string().uuid();

export const WEEKDAYS = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"] as const;

export const groupImagesSchema = z.object({ id: uuid, on: z.enum(["on", "off"]).transform((v) => v === "on") });

export const SHIFT_LIMIT = 100;
export const shiftRowSchema = z
  .object({
    weekday: z.number().int().min(0).max(6),
    start_hour: z.number().int().min(0).max(23),
    end_hour: z.number().int().min(1).max(24),
  })
  .refine((v) => v.end_hour > v.start_hour, { message: "A shift must end after it starts. For an overnight shift add two rows." });
export type ShiftRow = z.infer<typeof shiftRowSchema>;

const BAD_SHIFTS = "Each shift needs a day (Monday to Sunday) and whole hours, with the end after the start. For an overnight shift add two rows.";
export const setShiftsSchema = z.object({
  staff_id: uuid,
  shifts: z
    .string()
    .transform((s, ctx): unknown => {
      try {
        return JSON.parse(s) as unknown;
      } catch {
        ctx.addIssue({ code: "custom", message: BAD_SHIFTS });
        return z.NEVER;
      }
    })
    .pipe(z.array(shiftRowSchema, { message: BAD_SHIFTS }).max(SHIFT_LIMIT, `Please use at most ${SHIFT_LIMIT} shifts.`)),
});

export const NOTES_MAX = 2000;
export const STEPS_MAX = 50;

const LOCAL_TIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/;
/** A time typed on the form is Lagos time (UTC+1, no daylight saving). */
const lagosTimeRequired = z
  .string()
  .trim()
  .transform((v, ctx): string => {
    const d = LOCAL_TIME.test(v) ? new Date(`${v}:00+01:00`) : new Date(Number.NaN);
    if (Number.isNaN(d.getTime())) {
      ctx.addIssue({ code: "custom", message: "Please give the start and end date and time." });
      return z.NEVER;
    }
    return d.toISOString();
  });

export const QA_TITLE_MIN = 3;
export const QA_TITLE_MAX = 80;
export const QA_INTRO_MAX = 300;
export const QA_MAX_HOURS = 12;
export const QA_DOCTORS_MAX = 20;
export const QA_GROUPS_MAX = 50;
/** The database allows a start up to 5 minutes in the past. */
const PAST_GRACE_MS = 5 * 60 * 1000;

export const createQaSchema = z
  .object({
    title: z.string().trim().min(QA_TITLE_MIN, "Please give the session a title of 3 to 80 characters.").max(QA_TITLE_MAX, "Please give the session a title of 3 to 80 characters."),
    intro: z.string().trim().max(QA_INTRO_MAX, "The introduction can be up to 300 characters."),
    opens_at: lagosTimeRequired,
    closes_at: lagosTimeRequired,
    doctor_ids: z.array(uuid).min(1, "Pick at least one doctor.").max(QA_DOCTORS_MAX, "Pick up to 20 doctors."),
    group_ids: z.array(uuid).min(1, "Pick at least one group.").max(QA_GROUPS_MAX, "Pick up to 50 groups."),
  })
  .refine((v) => v.closes_at > v.opens_at, { message: "The end time must be after the start time.", path: ["closes_at"] })
  .refine((v) => new Date(v.closes_at).getTime() - new Date(v.opens_at).getTime() <= QA_MAX_HOURS * 3600 * 1000, {
    message: "A question session can run for up to 12 hours.",
    path: ["closes_at"],
  })
  .refine((v) => new Date(v.opens_at).getTime() >= Date.now() - PAST_GRACE_MS, { message: "The session cannot start in the past.", path: ["opens_at"] });

export const cancelQaSchema = z.object({ series_id: uuid });
