import { z } from "zod";

export const LEAD_ROLES = ["patient", "family", "employer", "hmo", "other"] as const;

export type LeadRole = (typeof LEAD_ROLES)[number];

export const leadSchema = z.object({
  name: z.string().trim().min(2, "Name is required"),
  contact: z
    .string()
    .trim()
    .min(5, "Enter an email address or phone number")
    .max(200),
  role: z.enum(LEAD_ROLES),
  message: z.string().trim().max(2000).optional(),
  source: z.string().trim().min(1).max(100).default("homepage"),
});

export type LeadInput = z.infer<typeof leadSchema>;
