import { z } from "zod";

export const LEAD_ROLES = ["patient", "family", "employer", "hmo", "ngo", "other"] as const;

export type LeadRole = (typeof LEAD_ROLES)[number];

// Optional, motivation-based segment for the Contact/Join form — separate
// from `role` (who the lead is) and used only for marketing-site conversion
// tracking. A lead who leaves it blank is still a fully valid lead.
export const LEAD_GOALS = [
  "managing_a_condition",
  "staying_ahead",
  "family_care",
  "fast_doctor_access",
  "one_record",
  "still_exploring",
] as const;

export type LeadGoal = (typeof LEAD_GOALS)[number];

export const leadSchema = z.object({
  name: z.string().trim().min(2, "Name is required"),
  contact: z
    .string()
    .trim()
    .min(5, "Enter an email address or phone number")
    .max(200),
  role: z.enum(LEAD_ROLES),
  goal: z.enum(LEAD_GOALS).optional(),
  message: z.string().trim().max(2000).optional(),
  source: z.string().trim().min(1).max(100).default("homepage"),
});

export type LeadInput = z.infer<typeof leadSchema>;
