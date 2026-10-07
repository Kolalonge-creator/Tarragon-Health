import { z } from "zod";

/**
 * Provisions a login-less profile for a consenting ADULT who cannot
 * self-onboard — "my father does not use smartphones"
 * (docs/FAMILY_CARE_CIRCLE_SPEC.md §3.2). Mirrors addChildDependentSchema's
 * shape (see add-child-dependent.ts) but inverted: 18+ instead of under-18,
 * plus a phone number (so the server action can refuse if it already
 * resolves to a real account — a self-capable adult who simply hasn't
 * signed up belongs in the ordinary eldercare care_access_requests flow,
 * where THEY accept, not this one) and an explicit, required consent
 * attestation, since nobody here is verifying that consent the way a
 * two-sided care_access_requests accept would.
 */
export const addElderProxyDependentSchema = z.object({
  full_name: z.string().trim().min(1, "Enter their name").max(200),
  phone: z
    .string()
    .trim()
    .regex(/^\+\d{10,15}$/, "Use the international format, e.g. +2348012345678"),
  relationship: z.string().trim().min(1, "Enter your relationship to them").max(60),
  date_of_birth: z
    .string()
    .refine((value) => !Number.isNaN(Date.parse(value)), "Enter a valid date")
    .refine((value) => new Date(value) <= new Date(), "Date of birth can't be in the future")
    .refine((value) => {
      const eighteenYearsAgo = new Date();
      eighteenYearsAgo.setFullYear(eighteenYearsAgo.getFullYear() - 18);
      return new Date(value) <= eighteenYearsAgo;
    }, "This is for adults 18 and over — for a child, use “Add a child” instead"),
  sex: z.enum(["male", "female"]).optional(),
  confirmed_consent: z.literal(true, {
    message: "Confirm they've agreed to this before continuing",
  }),
  // OQ-47 (S42): this path gives the proxy access before the person has confirmed anything, so it is only for someone who
  // cannot confirm. Anyone who can receive a text message goes through "Set up for my parent" and confirms on their own phone.
  // The reason is recorded in the audit log.
  reason: z.enum(["cannot_receive_code", "cannot_set_up_themselves"], {
    message: "Say why they cannot confirm this on their own phone. If they can receive a text message, use “Set up for my parent” instead",
  }),
});

export const ELDER_PROXY_REASONS = [
  { value: "cannot_receive_code", label: "They cannot receive or enter a text message code" },
  { value: "cannot_set_up_themselves", label: "They cannot set this up themselves, for example because of illness" },
] as const;

export type AddElderProxyDependentInput = z.infer<typeof addElderProxyDependentSchema>;

/**
 * A matured dependent's own real phone number, attached by
 * claimDependentAccountAction once private.sweep_dependent_majority_review
 * has flagged them — see claim-dependent-actions.ts.
 */
export const claimDependentAccountSchema = z.object({
  dependent_id: z.string().uuid(),
  phone: z
    .string()
    .trim()
    .regex(/^\+\d{10,15}$/, "Use the international format, e.g. +2348012345678"),
});

export type ClaimDependentAccountInput = z.infer<typeof claimDependentAccountSchema>;
