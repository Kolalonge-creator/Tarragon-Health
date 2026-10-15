import { z } from "zod";

const timeOnly = z
  .string()
  .regex(/^\d{2}:\d{2}$/, "Use an hh:mm time")
  .nullish();

export const setSleepGoalSchema = z.object({
  target_duration_hours: z.coerce.number().min(0).max(24).nullish(),
  target_bedtime: timeOnly,
  target_waketime: timeOnly,
});
export type SetSleepGoalInput = z.infer<typeof setSleepGoalSchema>;

/** 0 = would never doze off during the day, 3 = high chance of dozing — a
 * short single-item stand-in for full Epworth-style daytime sleepiness
 * (spec §18.11), not the 8-item clinical instrument. */
export const DAYTIME_SLEEPINESS_LABELS: Record<number, string> = {
  0: "Never",
  1: "Slight chance",
  2: "Moderate chance",
  3: "High chance",
};

/** A blank optional number field posts "", which z.coerce would turn into 0: treat blank as not given. */
const optionalWhole = (max: number) =>
  z.preprocess((v) => (v === "" || v === null || v === undefined ? undefined : v), z.coerce.number().int().min(0).max(max).optional());

export const logSleepEntrySchema = z.object({
  // Short diary fields (S57, 10.10): both optional.
  sleep_latency_minutes: optionalWhole(600),
  night_awakenings: optionalWhole(30),
  duration_hours: z.coerce.number().min(0).max(24),
  quality_rating: z.coerce.number().int().min(1).max(5).nullish(),
  bedtime: timeOnly,
  waketime: timeOnly,
  daytime_sleepiness: z.coerce.number().int().min(0).max(3).nullish(),
  note: z.string().trim().max(300).nullish(),
});
export type LogSleepEntryInput = z.infer<typeof logSleepEntrySchema>;

/** Abnormal-finding thresholds for spec §18.11's "abnormal findings can
 * trigger appropriate clinical assessment" — deliberately conservative
 * (short duration AND high daytime sleepiness together, not either alone)
 * to avoid over-flagging a single rough night. */
export const SLEEP_ABNORMAL_DURATION_HOURS = 4;
export const SLEEP_ABNORMAL_SLEEPINESS = 3;
