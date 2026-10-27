import { z } from "zod";

/**
 * What the caregiver-in-a-call screens read from the database (CGJ). Every reply is parsed, never trusted: a shape that does not match
 * is treated as "nothing to show", not rendered half-wrong. Nothing in these shapes is a link, a key, a reading or a surname: the
 * clinician sees the Care Circle's relationship label and a state, the patient sees the first names they chose themselves.
 */
const passSchema = z.object({
  pass_id: z.string(),
  relationship: z.string(),
  state: z.enum(["invited", "accepted", "declined", "removed"]),
  expires_at: z.string(),
  present: z.boolean(),
  removable: z.boolean(),
  /** Null for the clinician, on purpose. */
  name: z.string().nullable(),
});
export type CaregiverPass = z.infer<typeof passSchema>;

const invitableSchema = z.object({ member_id: z.string(), name: z.string(), relationship: z.string() });
export type InvitableMember = z.infer<typeof invitableSchema>;

const listSchema = z.object({
  role: z.enum(["patient", "clinician"]),
  live: z.boolean(),
  max: z.number().int().min(1),
  passes: z.array(passSchema),
  invitable: z.array(invitableSchema),
});
export type CaregiverList = z.infer<typeof listSchema>;

export function parseCaregiverList(data: unknown): CaregiverList | null {
  const r = listSchema.safeParse(data);
  return r.success ? r.data : null;
}

const inviteSchema = z.object({
  pass_id: z.string(),
  encounter_id: z.string(),
  patient_id: z.string(),
  patient_first_name: z.string(),
  relationship: z.string(),
  state: z.enum(["invited", "accepted"]),
  scheduled_at: z.string(),
  expires_at: z.string(),
  join_opens_at: z.string(),
  join_closes_at: z.string(),
  joinable: z.boolean(),
  final_media_mode: z.enum(["video", "audio_only", "phone"]).nullable(),
});
export type CaregiverInvite = z.infer<typeof inviteSchema>;

export function parseCaregiverInvites(data: unknown): CaregiverInvite[] {
  const r = z.array(inviteSchema).safeParse(data);
  return r.success ? r.data : [];
}

/** The passes that still count against the cap: an answered "no" or a removal frees the place. */
export const activePasses = (list: CaregiverList): CaregiverPass[] => list.passes.filter((p) => p.state === "invited" || p.state === "accepted");
