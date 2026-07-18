import { z } from "zod";
import { E164_NG } from "@tarragon/shared";

export const addFamilyPlanMemberSchema = z.object({
  member_phone: z.string().regex(E164_NG, "Enter a Nigerian number, e.g. +234XXXXXXXXXX"),
  relationship: z.enum(["spouse", "parent", "child", "sibling", "other"]),
});

export type AddFamilyPlanMemberInput = z.infer<typeof addFamilyPlanMemberSchema>;
