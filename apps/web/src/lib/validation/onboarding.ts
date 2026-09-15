import { z } from "zod";

/**
 * Demographics collected during onboarding. DOB + sex are required before a
 * patient can finish onboarding (enforced structurally by the
 * profiles_enforce_onboarding_prereqs trigger) because the risk-scoring and
 * screening-recommendation engines are age/sex-dependent.
 */
export const demographicsSchema = z.object({
  dateOfBirth: z
    .string()
    .min(1, "Enter your date of birth")
    .refine((value) => !Number.isNaN(Date.parse(value)), "Enter a valid date")
    .refine((value) => new Date(value) <= new Date(), "Date of birth can't be in the future")
    .refine(
      (value) => new Date(value) >= new Date("1900-01-01"),
      "Enter a valid date of birth",
    ),
  sex: z.enum(["male", "female"], { message: "Select your sex" }),
});

export type DemographicsInput = z.infer<typeof demographicsSchema>;

/**
 * The consent step records acceptance of every current consent version. The
 * UI shows the actual consent text (data processing, remote care, terms) and
 * a single required confirmation; the server records one patient_consents row
 * per current version. `accept` must be literally true.
 */
export const consentSchema = z.object({
  accept: z.literal(true, { message: "Please accept to continue" }),
});

export type ConsentInput = z.infer<typeof consentSchema>;

/**
 * Optional identity verification (KYC). NIN and BVN are both 11 digits in
 * Nigeria, checked against a live provider (see lib/identity/provider.ts).
 * Document verification (passport/driver's licence/voter's card) has no
 * provider — it always lands as `pending` for ops/staff manual review, same
 * posture as a NIN/BVN submission when no provider is configured. Never a
 * blocker — a patient can skip identity verification entirely.
 */
export const identityDocumentTypes = ["passport", "drivers_license", "voters_card", "national_id_card"] as const;
export type IdentityDocumentType = (typeof identityDocumentTypes)[number];

export const identityVerificationSchema = z
  .object({
    method: z.enum(["nin", "bvn", "document"], { message: "Choose NIN, BVN, or a document" }),
    idNumber: z.string().trim().min(1, "Enter the number"),
    documentType: z.enum(identityDocumentTypes).optional(),
  })
  .superRefine((value, ctx) => {
    if (value.method === "document") {
      if (!value.documentType) {
        ctx.addIssue({ code: "custom", path: ["documentType"], message: "Choose a document type" });
      }
      if (value.idNumber.length < 4) {
        ctx.addIssue({ code: "custom", path: ["idNumber"], message: "Enter the document's reference number" });
      }
      return;
    }
    if (!/^\d{11}$/.test(value.idNumber)) {
      ctx.addIssue({ code: "custom", path: ["idNumber"], message: "Enter the 11-digit number" });
    }
  });

export type IdentityVerificationInput = z.infer<typeof identityVerificationSchema>;
