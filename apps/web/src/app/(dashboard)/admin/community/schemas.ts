import { z } from "zod";

/** Input rules for the admin forms. Limits that are PROPOSED configuration live in the database and are enforced there, not here. */
export const SLUG = /^(?=[a-z0-9-]{4,60}$)[a-z0-9]+(-[a-z0-9]+)*$/;
export const TOPIC_CODE = /^[a-z](?=[a-z0-9_]{2,40}$)[a-z0-9]*(_[a-z0-9]+)*$/;

const uuid = z.string().uuid();
const blankToNull = (v: unknown) => (typeof v === "string" && v.trim() === "" ? null : v);

export const SAFETY_CLASSES = ["emergency", "self_harm"] as const;
export const RULE_CLASSES = ["contact", "contact_platform", "commerce", "cure_claim", "medicine_instruction", "abuse", "spam"] as const;
export const DETECTORS = ["phone_digits", "email", "url", "handle"] as const;

export const createGroupSchema = z.object({
  name: z.string().trim().min(3, "Please give the group a name of at least 3 letters.").max(80),
  slug: z.string().trim().regex(SLUG, "The address needs 4 to 60 lowercase letters, numbers and hyphens."),
  description: z.string().trim().max(600),
  topic_code: z.string().trim().min(1, "Please choose a topic."),
  rules_text: z.string().trim().min(1, "Please write the group rules."),
});
export const editGroupSchema = z.object({
  id: uuid,
  slug: z.string().trim().regex(SLUG),
  name: z.string().trim().min(3, "Please give the group a name of at least 3 letters.").max(80),
  description: z.string().trim().max(600),
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
    pattern: z.string().trim().min(1, "Please give a pattern.").max(400),
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
export const unpinSchema = z.object({ id: uuid, group_id: uuid });

/** Group size cap: empty means no limit, otherwise a whole number from 10 to 100000 (the database limits). */
export const CAP_MIN = 10;
export const CAP_MAX = 100000;
export const groupCapSchema = z.object({
  id: uuid,
  cap: z.preprocess(
    blankToNull,
    z.coerce.number({ message: "Use a whole number from 10 to 100000, or leave it empty for no limit." })
      .int("Use a whole number from 10 to 100000, or leave it empty for no limit.")
      .min(CAP_MIN, "Use a whole number from 10 to 100000, or leave it empty for no limit.")
      .max(CAP_MAX, "Use a whole number from 10 to 100000, or leave it empty for no limit.")
      .nullable(),
  ),
});

/** A group prompt: a short line shown at the top of a group (the database limits: 5 to 300 characters). */
export const PROMPT_MIN = 5;
export const PROMPT_MAX = 300;
const LOCAL_TIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/;
/** A time typed on the form is Lagos time (UTC+1, no daylight saving). Blank means not set. */
const lagosTime = z
  .string()
  .trim()
  .transform((v, ctx): string | null => {
    if (v === "") return null;
    const d = LOCAL_TIME.test(v) ? new Date(`${v}:00+01:00`) : new Date(Number.NaN);
    if (Number.isNaN(d.getTime())) {
      ctx.addIssue({ code: "custom", message: "Please give the date and time again." });
      return z.NEVER;
    }
    return d.toISOString();
  });
export const savePromptSchema = z
  .object({
    group_id: uuid,
    body: z.string().trim().min(PROMPT_MIN, "Please write between 5 and 300 characters.").max(PROMPT_MAX, "Please write between 5 and 300 characters."),
    show_from: lagosTime,
    show_until: lagosTime,
  })
  .refine((v) => v.show_until === null || v.show_from === null || v.show_until > v.show_from, {
    message: "The end time must be after the start time.",
    path: ["show_until"],
  });
export const endPromptSchema = z.object({ id: uuid });
