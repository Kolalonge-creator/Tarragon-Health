import { z } from "zod";

/**
 * A child family member has never signed up and never will — unlike every
 * other family_plan_members relationship (spouse/parent/sibling/other),
 * which requires the member to already hold their own account (see
 * find_profile_by_phone in lib/queries/family-plan-members.ts). This is the
 * one path that provisions a brand-new, no-login `profiles` row on the
 * parent's behalf (profiles.id is a hard FK to auth.users, so there is no
 * way to represent "a profile with nobody behind it" other than a real,
 * password-less auth user — see add-child-actions.ts).
 */
export const addChildDependentSchema = z.object({
  full_name: z.string().trim().min(1, "Enter the child's name").max(200),
  date_of_birth: z
    .string()
    .refine((value) => !Number.isNaN(Date.parse(value)), "Enter a valid date")
    .refine((value) => new Date(value) <= new Date(), "Date of birth can't be in the future")
    .refine((value) => {
      const eighteenYearsAgo = new Date();
      eighteenYearsAgo.setFullYear(eighteenYearsAgo.getFullYear() - 18);
      return new Date(value) >= eighteenYearsAgo;
    }, "This form is for children under 18"),
  sex: z.enum(["male", "female"]).optional(),
});

export type AddChildDependentInput = z.infer<typeof addChildDependentSchema>;
