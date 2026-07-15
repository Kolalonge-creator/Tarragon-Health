import { z } from "zod";

export const rosterMemberSchema = z.object({
  phone: z
    .string()
    .trim()
    .regex(/^\+[1-9][0-9]{7,14}$/, "Use E.164 format, e.g. +2348012345678"),
  full_name: z.string().trim().max(200).optional().or(z.literal("").transform(() => undefined)),
});
export type RosterMemberInput = z.infer<typeof rosterMemberSchema>;
