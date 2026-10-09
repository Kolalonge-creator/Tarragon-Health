import { z } from "zod";

/** Input rules for the admin forms. Limits that are PROPOSED configuration live in the database and are enforced there, not here. */
export const SLUG = /^[a-z0-9]+(-[a-z0-9]+)*$/;
export const TOPIC_CODE = /^[a-z0-9]+(_[a-z0-9]+)*$/;

const uuid = z.string().uuid();
const blankToNull = (v: unknown) => (typeof v === "string" && v.trim() === "" ? null : v);

export const SAFETY_CLASSES = ["emergency", "self_harm"] as const;
export const RULE_CLASSES = ["contact", "contact_platform", "commerce", "cure_claim", "medicine_instruction", "abuse", "spam"] as const;
export const DETECTORS = ["phone_digits", "email", "url", "handle"] as const;

export const createGroupSchema = z.object({
  name: z.string().trim().min(2, "Please give the group a name.").max(120),
  slug: z.string().trim().regex(SLUG, "The address can use lowercase letters, numbers and hyphens only."),
  description: z.string().trim().max(1000),
  topic_code: z.string().trim().min(1, "Please choose a topic."),
  rules_text: z.string().trim().min(1, "Please write the group rules."),
});
export const editGroupSchema = z.object({
  id: uuid,
  slug: z.string().trim().regex(SLUG),
  name: z.string().trim().min(2, "Please give the group a name.").max(120),
  description: z.string().trim().max(1000),
  topic_code: z.string().trim().min(1, "Please choose a topic."),
  rules_text: z.string().trim().min(1, "Please write the group rules."),
});
export const groupStatusSchema = z.object({
  id: uuid,
  slug: z.string().trim().regex(SLUG),
  status: z.enum(["active", "read_only", "archived"]),
});
export const topicSchema = z.object({
  code: z.string().trim().regex(TOPIC_CODE, "The code can use lowercase letters, numbers and underscores only."),
  label: z.string().trim().min(2, "Please give the topic a label.").max(80),
  description: z.preprocess(blankToNull, z.string().trim().max(500).nullable()),
  sort_order: z.coerce.number().int().min(0).max(100000),
  is_active: z.boolean(),
  requires_cmo_rules: z.boolean(),
});
export const grantSchema = z.object({
  profile_id: uuid,
  scope: z.enum(["moderator", "safety_reviewer"]),
  group_id: z.preprocess(blankToNull, uuid.nullable()),
});
export const revokeSchema = z.object({ id: uuid });
export const versionSchema = z.object({ version: z.coerce.number().int().positive() });
export const newDraftSchema = z.object({ from_version: z.preprocess(blankToNull, z.coerce.number().int().positive().nullable()) });
export const ruleSaveSchema = z
  .object({
    version: z.coerce.number().int().positive(),
    class: z.enum(RULE_CLASSES),
    kind: z.enum(["regex", "detector"]),
    pattern: z.string().trim().min(1, "Please give a pattern.").max(500),
    action: z.enum(["block", "hold"]),
  })
  .refine((v) => v.kind !== "detector" || (DETECTORS as readonly string[]).includes(v.pattern), {
    message: "A detector must be one of: phone_digits, email, url, handle.",
    path: ["pattern"],
  });
export const ruleDeleteSchema = z.object({ version: z.coerce.number().int().positive(), rule_id: z.coerce.number().int().positive() });
export const HOSTNAME = /^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$/;
export const hostsSchema = z.object({
  version: z.coerce.number().int().positive(),
  hosts: z.string().transform((s) => s.split(/[\s,]+/).map((h) => h.trim().toLowerCase()).filter(Boolean)),
});
export const unmaskSchema = z.object({
  group_id: uuid,
  handle: z.string().trim().min(1, "Please enter the community name.").max(80),
  reason: z.string().trim().min(1, "Please write the reason."),
});
export const unpinSchema = z.object({ id: uuid, group_id: uuid });
