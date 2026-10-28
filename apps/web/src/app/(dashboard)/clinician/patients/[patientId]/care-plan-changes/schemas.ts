import { z } from "zod";

/**
 * S24: the shapes a clinician can send to the care plan change functions (public.propose_care_plan_change, sign_care_plan_change,
 * reject_care_plan_change). Zod runs on the server action input; the database repeats every rule and stays the gate.
 */

const uuid = z.string().uuid("That does not look like a valid id");

/** Matches the database minimums (care_change_config minRationaleChars / minPatientSummaryChars, both 10). */
export const MIN_RATIONALE_CHARS = 10;
export const MIN_SUMMARY_CHARS = 10;

export const rationaleSchema = z
  .string()
  .trim()
  .min(MIN_RATIONALE_CHARS, "Say why this change is proposed (at least a short sentence)")
  .max(1000, "Keep the rationale under 1000 characters");

const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .optional()
    .transform((v) => (v ? v : undefined));

export const medicineItemSchema = z.object({
  drug_name: z.string().trim().min(1, "Enter the medicine name").max(200),
  dose: optionalText(100),
  frequency: optionalText(100),
  route: optionalText(100),
  duration_days: z.coerce
    .number({ message: "Enter how many days this supply covers" })
    .int("Enter a whole number of days")
    .positive("Enter how many days this supply covers")
    .max(366, "A supply cannot cover more than a year"),
  quantity: z.string().trim().min(1, "Enter the quantity to dispense, for example 30 tablets").max(100),
  repeats_allowed: z.preprocess((v) => (v === "" || v === null ? undefined : v), z.coerce.number().int().min(0).max(99).optional()),
  indication: optionalText(300),
  instructions: optionalText(1000),
});

/**
 * S50b (6.13): a medicine start or change that is the clinician's TIMING PLAN for a religious fast. A start is how the care team replaces a medicine the person
 * typed in themselves with one it issues (a self-entered medicine can never be covered, because only an issued prescription carries a signature). It is an ordinary signed change (same signature, same patient
 * confirmation, same safety checks); the "fasting" block only tags which fast it is for and the dates it covers, so the fasting gate can see that a
 * clinician-signed plan exists. The platform never proposes a timing: the clinician types it into the medicine's schedule and instructions.
 */
export const fastingTagSchema = z
  .object({
    fast: z.enum(["ramadan", "lent"], { message: "Choose Ramadan or Lent" }),
    valid_from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Enter the first day this plan covers"),
    valid_to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Enter the last day this plan covers"),
  })
  .refine((f) => f.valid_to >= f.valid_from, { message: "The plan cannot end before it starts" })
  .refine((f) => (Date.parse(f.valid_to) - Date.parse(f.valid_from)) / 86_400_000 <= 120, { message: "A fasting plan covers at most 120 days" });

export const proposeMedicineChangeSchema = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("start"),
    patientId: uuid,
    item: medicineItemSchema,
    fasting: fastingTagSchema.optional(),
    rationale: rationaleSchema,
  }),
  z.object({
    action: z.literal("change"),
    patientId: uuid,
    medicationId: uuid,
    item: medicineItemSchema,
    fasting: fastingTagSchema.optional(),
    rationale: rationaleSchema,
  }),
  z.object({
    action: z.literal("stop"),
    patientId: uuid,
    medicationId: uuid,
    rationale: rationaleSchema,
  }),
]);
export type ProposeMedicineChangeInput = z.input<typeof proposeMedicineChangeSchema>;
type ParsedMedicineChange = z.output<typeof proposeMedicineChangeSchema>;

/**
 * A fasting timing plan replaces the medicine row for as long as the new row's supply lasts. If the supply is shorter than the fast, the person would
 * have no active row for that medicine part-way through. Returns a sentence for the clinician, or null when the supply covers the whole window.
 */
export function fastingSupplyProblem(input: ParsedMedicineChange): string | null {
  if (input.action === "stop" || !input.fasting) return null;
  const days = Math.round((Date.parse(input.fasting.valid_to) - Date.parse(input.fasting.valid_from)) / 86_400_000) + 1;
  return input.item.duration_days >= days ? null : `The supply must last at least ${days} days so it covers the whole fast. Raise the duration, or shorten the dates.`;
}

/** The `proposal` object propose_care_plan_change stores for a medicine change. */
export function buildMedicineProposal(input: ParsedMedicineChange): Record<string, unknown> {
  if (input.action === "stop") return { action: "stop", medication_id: input.medicationId };
  const item = Object.fromEntries(Object.entries(input.item).filter(([, v]) => v !== undefined));
  if (input.action === "change") return { action: "change", medication_id: input.medicationId, item, ...(input.fasting ? { fasting: input.fasting } : {}) };
  return { action: "start", item, ...(input.fasting ? { fasting: input.fasting } : {}) };
}

const settingKey = z
  .string()
  .trim()
  .min(1, "Name each setting")
  .max(60)
  .transform((v) =>
    v
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "_")
      .replace(/^_+|_+$/g, "")
  )
  .refine((v) => /^[a-z][a-z0-9_]*$/.test(v), "Start each setting name with a letter");

const optionalNumber = z.preprocess(
  (v) => (v === "" || v === null || v === undefined ? undefined : v),
  z.coerce.number({ message: "Enter a number" }).finite().optional()
);

export const targetEntrySchema = z
  .object({ key: settingKey, min: optionalNumber, max: optionalNumber })
  .refine((e) => e.min !== undefined || e.max !== undefined, { message: "Give a lowest or a highest value for each target" })
  .refine((e) => e.min === undefined || e.max === undefined || e.min <= e.max, { message: "The lowest value cannot be above the highest" });

export const scheduleEntrySchema = z.object({
  key: settingKey,
  value: z.string().trim().min(1, "Say how often or when").max(100),
});

function uniqueKeys(entries: { key: string }[]): boolean {
  return new Set(entries.map((e) => e.key)).size === entries.length;
}

export const proposeTargetChangeSchema = z.object({
  patientId: uuid,
  carePlanId: uuid,
  entries: z.array(targetEntrySchema).min(1, "Add at least one target").max(12).refine(uniqueKeys, "Each target can appear once"),
  rationale: rationaleSchema,
});
export type ProposeTargetChangeInput = z.input<typeof proposeTargetChangeSchema>;
type ParsedTargetChange = z.output<typeof proposeTargetChangeSchema>;

export const proposeScheduleChangeSchema = z.object({
  patientId: uuid,
  carePlanId: uuid,
  entries: z.array(scheduleEntrySchema).min(1, "Add at least one reading").max(12).refine(uniqueKeys, "Each reading can appear once"),
  rationale: rationaleSchema,
});
export type ProposeScheduleChangeInput = z.input<typeof proposeScheduleChangeSchema>;
type ParsedScheduleChange = z.output<typeof proposeScheduleChangeSchema>;

/** `{ target_ranges: { blood_pressure: { min, max } } }` */
export function buildTargetProposal(input: ParsedTargetChange): Record<string, unknown> {
  const ranges: Record<string, Record<string, number>> = {};
  for (const e of input.entries) {
    const range: Record<string, number> = {};
    if (e.min !== undefined) range.min = e.min;
    if (e.max !== undefined) range.max = e.max;
    ranges[e.key] = range;
  }
  return { target_ranges: ranges };
}

/** `{ reading_schedule: { blood_pressure: "twice a day" } }` */
export function buildScheduleProposal(input: ParsedScheduleChange): Record<string, unknown> {
  const schedule: Record<string, string> = {};
  for (const e of input.entries) schedule[e.key] = e.value;
  return { reading_schedule: schedule };
}

/** Signing: the summary the patient will read, plus the answers to a signing safety stop. */
export const signChangeSchema = z.object({
  patientId: uuid,
  changeId: uuid,
  patientSummary: z.string().trim().min(MIN_SUMMARY_CHARS, "Write what this change means for the patient, in plain words").max(1000),
  allergiesConfirmed: z.boolean().default(false),
  overrideReason: z
    .string()
    .trim()
    .max(500)
    .optional()
    .transform((v) => (v ? v : undefined)),
});
export type SignChangeInput = z.input<typeof signChangeSchema>;

export const rejectChangeSchema = z.object({
  patientId: uuid,
  changeId: uuid,
  reason: z.string().trim().min(1, "Say why this change is being rejected").max(500),
});
export type RejectChangeInput = z.input<typeof rejectChangeSchema>;

export const patientIdSchema = z.object({ patientId: uuid });
