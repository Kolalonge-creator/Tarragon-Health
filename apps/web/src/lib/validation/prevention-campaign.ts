import { z } from "zod";
import { predicateSchema } from "./predicate-schema";

export const CAMPAIGN_ACTION_TYPES = [
  "education",
  "screening_invite",
  "assessment",
  "discount",
  "challenge",
] as const;

const actionSchema = z.object({
  type: z.enum(CAMPAIGN_ACTION_TYPES),
  detail: z.string().min(1).max(500),
});

/** codes are stable slugs, e.g. "heart-health-month-2026" — used in URLs/analytics. */
const codePattern = /^[a-z0-9]+(-[a-z0-9]+)*$/;

export const preventionCampaignFormSchema = z
  .object({
    code: z.string().regex(codePattern, "Use lowercase letters, numbers, and hyphens only"),
    name: z.string().min(1).max(200),
    description: z.string().max(2000).optional(),
    starts_on: z.string().min(1),
    ends_on: z.string().optional(),
    eligibility_rule_json: z.string().min(1).superRefine((raw, ctx) => {
      let parsed: unknown;
      try {
        parsed = JSON.parse(raw);
      } catch {
        ctx.addIssue({ code: "custom", message: "Eligibility rule is not valid JSON" });
        return;
      }
      if (!predicateSchema.safeParse(parsed).success) {
        ctx.addIssue({ code: "custom", message: "Eligibility rule does not match the expected predicate shape" });
      }
    }),
    actions_json: z.string().min(1).superRefine((raw, ctx) => {
      let parsed: unknown;
      try {
        parsed = JSON.parse(raw);
      } catch {
        ctx.addIssue({ code: "custom", message: "Actions is not valid JSON" });
        return;
      }
      if (!z.array(actionSchema).min(1).safeParse(parsed).success) {
        ctx.addIssue({ code: "custom", message: "Actions must be a non-empty array of {type, detail}" });
      }
    }),
  })
  .superRefine((data, ctx) => {
    if (data.ends_on && data.ends_on < data.starts_on) {
      ctx.addIssue({ code: "custom", path: ["ends_on"], message: "End date must be on or after the start date" });
    }
  });

export type PreventionCampaignFormValues = z.infer<typeof preventionCampaignFormSchema>;
