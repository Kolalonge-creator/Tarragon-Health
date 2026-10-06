import { z } from "zod";

/** A draft or approved row of `triage_rule_sets` (S11), read for the CMO's review screen. */
export const ruleSetRowSchema = z.object({
  id: z.string().uuid(),
  code: z.string(),
  version: z.number().int(),
  status: z.enum(["draft", "approved", "retired"]),
  approved_by: z.string().uuid().nullable(),
  approved_at: z.string().nullable(),
  note: z.string().nullable(),
  rules: z.unknown(),
});
export type RuleSetRow = z.infer<typeof ruleSetRowSchema>;

const actionSchema = z.object({ kind: z.string(), task: z.string().optional(), dueMinutes: z.number().optional() }).passthrough();
const ruleSchema = z.object({
  id: z.string(),
  description: z.string(),
  result: z.enum(["grade", "recheck"]),
  grade: z.enum(["green", "amber", "red"]).optional(),
  actions: z.array(actionSchema),
});
const rulesSchema = z.object({ rules: z.array(ruleSchema) }).passthrough();

export interface RuleSummary {
  id: string;
  description: string;
  outcome: "red" | "amber" | "green" | "repeat reading";
  pagesOnCall: boolean;
  tasks: { task: string; dueMinutes: number | null }[];
}

/** Reads the rule list out of the rule set JSON for display. Returns null if the JSON is not the shape the engine reads. */
export function summariseRules(rules: unknown): RuleSummary[] | null {
  const parsed = rulesSchema.safeParse(rules);
  if (!parsed.success) return null;
  return parsed.data.rules.map((r) => ({
    id: r.id,
    description: r.description,
    outcome: r.result === "recheck" ? "repeat reading" : (r.grade ?? "green"),
    pagesOnCall: r.actions.some((a) => a.kind === "page_on_call"),
    tasks: r.actions.filter((a) => a.kind === "create_task" && a.task).map((a) => ({ task: a.task as string, dueMinutes: a.dueMinutes ?? null })),
  }));
}

/** The signature button appears only when the rule set is a draft and no task type still waits for the CMO. */
export function canOfferApproval(status: RuleSetRow["status"], unconfirmedTaskTypes: number): boolean {
  return status === "draft" && unconfirmedTaskTypes === 0;
}
