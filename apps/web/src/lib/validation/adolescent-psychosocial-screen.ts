import { z } from "zod";

/**
 * Adolescent psychosocial check-in (spec §49.5/§49.6) — a lean, self-
 * administered adaptation of the HEEADSSS interview. Scored server-side by
 * apps/web/src/lib/rules/adolescent-psychosocial-screening.ts, never
 * trusting a client-computed flag.
 */

const yesNo = z.enum(["yes", "no"]);

export const adolescentPsychosocialScreenSchema = z.object({
  home_feels_safe: yesNo,
  home_hurt_or_threatened: yesNo,
  education_note: z.string().max(500).optional().default(""),
  days_active_per_week: z.coerce.number().int().min(0).max(7),
  sleep_hours_per_night: z.coerce.number().min(0).max(24),
  substance_use_last_month: yesNo,
  sexual_health_support_requested: yesNo,
  self_harm_thoughts: yesNo,
  unsafe_elsewhere: yesNo,
  immediate_danger: yesNo,
  notes: z.string().max(1000).optional().default(""),
});

export type AdolescentPsychosocialScreenInput = z.infer<typeof adolescentPsychosocialScreenSchema>;

export const YES_NO_OPTIONS: { value: YesNoOption; label: string }[] = [
  { value: "no", label: "No" },
  { value: "yes", label: "Yes" },
];
type YesNoOption = "yes" | "no";
