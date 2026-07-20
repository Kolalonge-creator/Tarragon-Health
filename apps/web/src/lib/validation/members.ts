import { z } from "zod";

/** Every account/login role (public.user_role). Used for provisioning + role assignment. */
export const USER_ROLES = [
  "patient",
  "clinician",
  "doctor",
  "care_coordinator",
  "pharmacist",
  "analyst",
  "lab_liaison",
  "hmo_admin",
  "corporate_admin",
  "admin",
] as const;

export type UserRoleValue = (typeof USER_ROLES)[number];

/** Human labels for the account roles, shown in the provisioning + assignment UI. */
export const USER_ROLE_LABELS: Record<UserRoleValue, string> = {
  patient: "Patient",
  clinician: "Clinician (Medical Officer T1–T3)",
  doctor: "Doctor (Senior Registrar / Specialist T4–T5)",
  care_coordinator: "Care Coordinator",
  pharmacist: "Pharmacist",
  analyst: "Platform Analyst",
  lab_liaison: "Lab Liaison Officer",
  hmo_admin: "HMO Admin",
  corporate_admin: "Employer/Corporate Admin",
  admin: "Super Admin",
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

export const provisionMemberSchema = z.object({
  email: z.string().email(),
  fullName: z.string().min(1, "Full name is required").max(200),
  phone: e164,
  role: z.enum(USER_ROLES),
  organisationId: optionalUuid,
  password: z.string().min(8, "At least 8 characters").max(72),
});

export type ProvisionMemberInput = z.infer<typeof provisionMemberSchema>;
