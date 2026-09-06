import { z } from "zod";
import type { Enums } from "@tarragon/shared";

/** Mirrors public.lifestyle_domain — spec §18.1's own domain list, kept
 * separate from the Lifestyle Programme Engine's Module vocabulary
 * (packages/lifestyle-engine), see the migration comment for why. */
export const LIFESTYLE_DOMAINS = [
  "nutrition",
  "activity",
  "weight",
  "sleep",
  "smoking",
  "alcohol",
  "stress",
] as const;
const _domainCheck: readonly Enums<"lifestyle_domain">[] = LIFESTYLE_DOMAINS;
void _domainCheck;

export const LIFESTYLE_DOMAIN_LABELS: Record<(typeof LIFESTYLE_DOMAINS)[number], string> = {
  nutrition: "Nutrition",
  activity: "Physical activity",
  weight: "Weight",
  sleep: "Sleep",
  smoking: "Smoking",
  alcohol: "Alcohol",
  stress: "Stress & wellbeing",
};

/** Mirrors public.lifestyle_barrier_code — spec §18.14's own option list. */
export const LIFESTYLE_BARRIER_CODES = [
  "cost",
  "time",
  "family",
  "work",
  "transport",
  "motivation",
  "symptoms",
  "side_effects",
  "access",
  "other",
] as const;
const _barrierCheck: readonly Enums<"lifestyle_barrier_code">[] = LIFESTYLE_BARRIER_CODES;
void _barrierCheck;

export const LIFESTYLE_BARRIER_LABELS: Record<(typeof LIFESTYLE_BARRIER_CODES)[number], string> = {
  cost: "Cost",
  time: "Not enough time",
  family: "Family responsibilities",
  work: "Work",
  transport: "Getting there / transport",
  motivation: "Motivation",
  symptoms: "Symptoms",
  side_effects: "Medication side effects",
  access: "Lack of access",
  other: "Something else",
};

export const reportLifestyleBarrierSchema = z
  .object({
    domain: z.enum(LIFESTYLE_DOMAINS),
    barrier_codes: z.array(z.enum(LIFESTYLE_BARRIER_CODES)).max(LIFESTYLE_BARRIER_CODES.length).default([]),
    note: z.string().trim().max(300).nullish(),
  })
  .refine((v) => v.barrier_codes.length > 0 || (v.note && v.note.length > 0), {
    message: "Pick at least one option or add a note",
    path: ["barrier_codes"],
  });
export type ReportLifestyleBarrierInput = z.infer<typeof reportLifestyleBarrierSchema>;
