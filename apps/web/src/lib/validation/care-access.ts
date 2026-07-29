import { z } from "zod";

/**
 * Relationships offered when nominating a next of kin. Deliberately a plain TS
 * union rather than a database enum: the old family_relationship type existed
 * only to describe who was on somebody's bill and went with that table in
 * 20260729143514. This value is stored as free text on
 * profiles.emergency_contact_relationship, which is where the escalation path
 * already reads it from.
 */
export const NEXT_OF_KIN_RELATIONSHIPS = [
  "spouse",
  "child",
  "parent",
  "sibling",
  "other",
] as const;

export type NextOfKinRelationship = (typeof NEXT_OF_KIN_RELATIONSHIPS)[number];

export const nominateNextOfKinSchema = z.object({
  full_name: z.string().trim().min(2, "Enter their full name").max(120),
  phone: z
    .string()
    .trim()
    .regex(/^\+\d{10,15}$/, "Use the international format, e.g. +2348012345678"),
  relationship: z.enum(NEXT_OF_KIN_RELATIONSHIPS),
});

export type NominateNextOfKinInput = z.infer<typeof nominateNextOfKinSchema>;
