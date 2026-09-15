import { z } from "zod";
import type { Enums } from "@tarragon/shared";

export const NAVIGATION_REQUEST_CATEGORIES: Enums<"navigation_request_category">[] = [
  "appointment",
  "pharmacy",
  "laboratory",
  "insurance",
  "referral",
  "payment",
  "technical",
  "other",
];

/** Patient/staff-facing label for each of module 75's fixed request categories (75.4). */
export const NAVIGATION_REQUEST_CATEGORY_LABEL: Record<Enums<"navigation_request_category">, string> = {
  appointment: "Appointment",
  pharmacy: "Pharmacy",
  laboratory: "Laboratory",
  insurance: "Insurance",
  referral: "Referral",
  payment: "Payment",
  technical: "Technical",
  other: "Something else",
};

/** Logging a new "I need help" request (75.4). classification is never taken
 * from the client -- private.classify_navigation_request derives it server-side. */
export const createNavigationRequestSchema = z.object({
  category: z.enum(
    NAVIGATION_REQUEST_CATEGORIES as [Enums<"navigation_request_category">, ...Enums<"navigation_request_category">[]]
  ),
  description: z.string().trim().min(10, "Tell us a bit more about what you need").max(2000),
  isComplaint: z.boolean().default(false),
});
export type CreateNavigationRequestInput = z.infer<typeof createNavigationRequestSchema>;

/** Resolving a request (75.16/75.18) -- a note is required, mirrors
 * private.enforce_navigation_request_update's own requirement. */
export const resolveNavigationRequestSchema = z.object({
  resolutionNote: z.string().trim().min(3, "Explain how this was resolved").max(2000),
});
export type ResolveNavigationRequestInput = z.infer<typeof resolveNavigationRequestSchema>;

/** Patient closed-loop feedback (75.17/75.18), submitted once resolved. */
export const navigationRequestFeedbackSchema = z.object({
  rating: z.number().int().min(1).max(5),
  comment: z.string().trim().max(1000).optional(),
});
export type NavigationRequestFeedbackInput = z.infer<typeof navigationRequestFeedbackSchema>;
