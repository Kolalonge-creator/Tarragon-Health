import { z } from "zod";

/** Every account/login role (public.user_role). Used for provisioning + role assignment. */
export const USER_ROLES = [
  "patient",
  "clinician",
  "care_coordinator",
  "pharmacist",
  "analyst",
  "lab_liaison",
  "lab_partner",
  "finance",
  "hmo_admin",
  "corporate_admin",
  "admin",
  // Module 27/28 — the account role exists so a seat can be provisioned and
  // linked to a payer_administrators/provider_org_members row ahead of
  // activation, but reaches nothing until a superadmin switches the module
  // on (public.set_platform_module) AND, for a provider org, that specific
  // organisation is is_operational. See platform_modules.
  "payer_admin",
  "provider_org_staff",
] as const;

export type UserRoleValue = (typeof USER_ROLES)[number];

/** Human labels for the account roles, shown in the provisioning + assignment UI. */
export const USER_ROLE_LABELS: Record<UserRoleValue, string> = {
  patient: "Patient",
  clinician: "Doctor (all tiers — set doctor_tier on clinical_staff for seniority/authority)",
  care_coordinator: "Care Coordinator",
  pharmacist: "Pharmacist",
  analyst: "Platform Analyst",
  lab_liaison: "Lab Liaison Officer",
  lab_partner: "Lab Partner (Partner Laboratory)",
  finance: "Finance Officer",
  hmo_admin: "HMO Admin",
  corporate_admin: "Employer/Corporate Admin",
  admin: "Super Admin",
  payer_admin: "Payer Admin (insurer platform — dormant until activated)",
  provider_org_staff: "Provider Organisation Staff (dormant until activated)",
};

const optionalUuid = z
  .string()
  .uuid()
  .optional()
  .or(z.literal(""))
  .transform((v) => (v ? v : undefined));

// E.164 — a leading + and 8–15 digits (Nigerian numbers are +234XXXXXXXXXX).
const e164 = z
  .string()
  .regex(/^\+\d{8,15}$/, "Phone must be E.164, e.g. +2348012345678")
  .optional()
  .or(z.literal(""))
  .transform((v) => (v ? v : undefined));

export const provisionMemberSchema = z
  .object({
    email: z.string().email(),
    fullName: z.string().min(1, "Full name is required").max(200),
    phone: e164,
    role: z.enum(USER_ROLES),
    organisationId: optionalUuid,
    password: z.string().min(8, "At least 8 characters").max(72),
  })
  // Clinicians must have a phone on file to be pageable for emergency vitals
  // red-flags (private.enqueue_critical_notification's recipient filter is
  // role='clinician' and phone is not null) — no other role is ever queried
  // by that paging path, so this is deliberately scoped to clinician only.
  .superRefine((data, ctx) => {
    if (data.role === "clinician" && !data.phone) {
      ctx.addIssue({
        path: ["phone"],
        code: z.ZodIssueCode.custom,
        message: "Phone is required for clinician accounts — used for emergency vitals paging.",
      });
    }
  });

export type ProvisionMemberInput = z.infer<typeof provisionMemberSchema>;

export const setMemberPhoneSchema = z.object({
  memberId: z.string().uuid(),
  phone: e164,
});

export type SetMemberPhoneInput = z.infer<typeof setMemberPhoneSchema>;
