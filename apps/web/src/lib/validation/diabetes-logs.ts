import { z } from "zod";

const noteField = z.string().trim().max(500).optional();

/**
 * Form-safe boolean. z.coerce.boolean() turns the STRING "false" into `true`
 * (any non-empty string is truthy) — a real bug hit before on other forms — so
 * map the actual form values explicitly.
 */
const formBool = z.preprocess(
  (v) => v === true || v === "true" || v === "on" || v === "1",
  z.boolean(),
);
const atField = z
  .string()
  .optional()
  .refine((v) => !v || !Number.isNaN(Date.parse(v)), { message: "Enter a valid date and time" });

/** §13.4 insulin types used in Nigeria. */
export const INSULIN_TYPES = ["soluble", "nph", "premixed", "analogue_rapid", "analogue_long"] as const;

export const insulinLogSchema = z.object({
  insulin_type: z.enum(INSULIN_TYPES),
  units: z.coerce.number().positive("Enter the units given").max(300, "That looks too high — please re-check"),
  injected_at: atField,
  note: noteField,
});
export type InsulinLogInput = z.infer<typeof insulinLogSchema>;

/** §18.1 daily foot self-check findings. */
export const FOOT_FINDINGS = ["cut", "blister", "redness", "swelling", "colour_change", "pain"] as const;

export const footSelfCheckSchema = z.object({
  any_problem: formBool,
  findings: z.array(z.enum(FOOT_FINDINGS)).default([]),
  photo_url: z.string().url().optional().or(z.literal("").transform(() => undefined)),
  note: noteField,
});
export type FootSelfCheckInput = z.infer<typeof footSelfCheckSchema>;

/** §17.4 sick-day log. */
export const APPETITE_LEVELS = ["normal", "reduced", "none"] as const;

export const sickDayLogSchema = z.object({
  illness: z.string().trim().max(300).optional(),
  appetite: z.enum(APPETITE_LEVELS),
  vomiting: formBool,
  note: noteField,
});
export type SickDayLogInput = z.infer<typeof sickDayLogSchema>;
