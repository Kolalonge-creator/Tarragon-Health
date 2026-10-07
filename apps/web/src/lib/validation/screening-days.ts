import { z } from "zod";

/** Mirrors requestScreeningDay's field-by-field checks (screening-days/actions.ts)
 * — same error copy, now enforced with the codebase's usual Zod + safeParse
 * pattern instead of a hand-rolled if-chain. */
export const requestScreeningDaySchema = z.object({
  hostName: z.string().trim().min(1, "Who is this screening day for?"),
  contactPhone: z.string().trim().optional(),
  location: z.string().trim().min(1, "Where will this happen?"),
  eventDate: z.string().min(1, "When is it happening?"),
  panelBundleId: z.string().min(1, "Choose which check you'd like people to have."),
  slotsRequested: z.coerce
    .number()
    .positive("How many people are coming?"),
  notes: z.string().trim().optional(),
});

export const payTowardScreeningDaySchema = z.object({
  screeningDayId: z.string().min(1, "Which screening day are you paying for?"),
  amountNaira: z.coerce.number().positive("Enter how much you'd like to pay."),
});

export const addScreeningDaySlotSchema = z.object({
  screeningDayId: z.string().min(1, "Which screening day?"),
  fullName: z.string().trim().min(1, "Their name?"),
  phone: z.string().trim().optional(),
});
