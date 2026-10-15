import { z } from "zod";

/**
 * Input for proposing a new kind of clinical work (S76 B4, spec 23 acceptance test). The type is created as a
 * proposal that still needs the Chief Medical Officer's confirmation; nothing here confirms anything.
 */
const csv = z
  .string()
  .transform((v) =>
    v
      .split(",")
      .map((x) => x.trim())
      .filter((x) => x.length > 0),
  );

const minutes = (label: string) => z.coerce.number({ message: `${label} must be a number.` }).int(`${label} must be a whole number.`).min(0, `${label} cannot be negative.`);

export const taskTypeProposalSchema = z
  .object({
    code: z
      .string()
      .trim()
      .regex(/^[a-z][a-z0-9_]{2,60}$/, "Use lower case letters, numbers and underscores, starting with a letter."),
    priorityClass: z.coerce.number().int().min(1, "Priority class is 1 to 9.").max(9, "Priority class is 1 to 9."),
    defaultDueMinutes: minutes("Expected time"),
    minTier: z.enum(["care_coordinator", "medical_officer", "senior_medical_officer", "chief_medical_officer"]),
    requiredCompetencies: csv,
    leadWindowMinutes: minutes("Named clinician window"),
    claimTimeoutMinutes: z.coerce.number().int().min(1, "A claim must be held for at least a minute."),
    pushable: z.boolean(),
    sourceTaskKeys: csv,
    note: z.string().trim().max(500),
  })
  .refine((v) => v.priorityClass !== 1 || v.leadWindowMinutes === 0, {
    message: "A class 1 task never has a named clinician window.",
    path: ["leadWindowMinutes"],
  });

export type TaskTypeProposalInput = z.infer<typeof taskTypeProposalSchema>;

export function toProposalRpcArgs(i: TaskTypeProposalInput): Record<string, unknown> {
  return {
    p_code: i.code,
    p_priority_class: i.priorityClass,
    p_default_due_minutes: i.defaultDueMinutes,
    p_min_tier: i.minTier,
    p_required_competencies: i.requiredCompetencies,
    p_lead_window_minutes: i.leadWindowMinutes,
    p_claim_timeout_minutes: i.claimTimeoutMinutes,
    p_pushable: i.pushable,
    p_source_task_keys: i.sourceTaskKeys,
    p_note: i.note === "" ? null : i.note,
  };
}
