"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { failureMessage, toResult } from "@/components/community/staff-rpc";
import { DRILL_NOTES_MAX, DRILL_REQUIRED_STEPS, DRILL_STEPS } from "@/components/community/drill-steps";
import type { RpcClient } from "@/lib/go-live/load";
import type { StaffActionResult } from "@/components/community/staff-types";

/**
 * Chief Medical Officer and clinician actions for Community. Every input is validated before any call. The database decides who may
 * do what (auth.uid() inside each function), so nothing here trusts a role sent by the browser. Replies are plain English.
 */

const PATH = "/clinician/community";
const SIGNOFF_PATH = `${PATH}/signoff`;

/** The sign-off page shows the same state as this page, so any change refreshes both. */
function refresh() {
  revalidatePath(PATH);
  revalidatePath(SIGNOFF_PATH);
}
const INVALID: StaffActionResult = { ok: false, message: "Please check what you entered and try again." };

export async function approveGroupRulesAction(input: unknown): Promise<StaffActionResult> {
  const parsed = z.object({ groupId: z.string().uuid(), rulesVersion: z.number().int().positive() }).safeParse(input);
  if (!parsed.success) return INVALID;
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("community_cmo_approve_group_rules", {
    p_group_id: parsed.data.groupId,
    p_rules_version: parsed.data.rulesVersion,
  });
  const result = toResult(data, error, { approved: "Approved. These rules are now the approved rules for the group." });
  if (result.ok) refresh();
  return result;
}

const ruleSchema = z.object({
  version: z.number().int().positive(),
  ruleClass: z.enum(["emergency", "self_harm"]),
  pattern: z.string().trim().min(1).max(2000),
  note: z.string().trim().max(500).optional(),
});

const RULE_SAVE_ERRORS = {
  "2201B": "That pattern is not a valid regular expression. Check the brackets and slashes, then try again.",
  "42501": "That was refused. Rules can only change while the set is a draft, and only the Chief Medical Officer can write these.",
  "22023": "That rule could not be saved. Please check it.",
  "23514": "That rule could not be saved. Please check the class and the pattern.",
} as const;

export async function saveSafetyRuleAction(input: unknown): Promise<StaffActionResult> {
  const parsed = ruleSchema.safeParse(input);
  if (!parsed.success) return INVALID;
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("community_admin_rule_save", {
    p_version: parsed.data.version,
    p_class: parsed.data.ruleClass,
    p_kind: "regex",
    p_pattern: parsed.data.pattern,
    p_action: "safety",
    ...(parsed.data.note ? { p_note: parsed.data.note } : {}),
  });
  const result = toResult(data, error, { ok: "Rule saved." }, RULE_SAVE_ERRORS);
  if (result.ok) refresh();
  return result;
}

export async function deleteSafetyRuleAction(input: unknown): Promise<StaffActionResult> {
  const parsed = z.object({ ruleId: z.number().int().positive() }).safeParse(input);
  if (!parsed.success) return INVALID;
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("community_admin_rule_delete", { p_rule_id: parsed.data.ruleId });
  const result = toResult(data, error, { ok: "Rule removed." }, {
    "42501": "That was refused. Rules can only change while the set is a draft, and only the Chief Medical Officer can remove these.",
  });
  if (result.ok) refresh();
  return result;
}

export async function createDraftRuleSetAction(): Promise<StaffActionResult> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("community_admin_rule_set_create", {});
  const result = toResult(data, error, { ok: "A new draft rule set was started, copied from the live one." });
  if (result.ok) refresh();
  return result;
}

export async function loadStarterSafetyRulesAction(): Promise<StaffActionResult> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("community_cmo_load_starter_safety_rules");
  const result = toResult(
    data,
    error,
    {
      ok: "The approved starter rules were loaded into a new draft. Read them, then activate the draft to sign them.",
      already_loaded: "A draft with the starter rules is already waiting. Read it, then activate it to sign it.",
    },
    { "42501": "Only the Chief Medical Officer can load the safety rules." },
  );
  if (result.ok) refresh();
  return result;
}

const ACTIVATE_ERRORS = {
  "42501":
    "This set cannot go live yet. It must block phone numbers, email addresses, links and handles, and a set with emergency or self-harm rules can only be made live by the Chief Medical Officer.",
  "22023": "Only a draft rule set can be made live.",
} as const;

export async function activateRuleSetAction(input: unknown): Promise<StaffActionResult> {
  const parsed = z.object({ version: z.number().int().positive() }).safeParse(input);
  if (!parsed.success) return INVALID;
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("community_admin_rule_set_activate", { p_version: parsed.data.version });
  const result = toResult(data, error, { ok: "The rule set is now live. The previous live version was retired." }, ACTIVATE_ERRORS);
  if (result.ok) refresh();
  return result;
}

const noteSchema = z.object({
  groupId: z.string().uuid(),
  title: z.string().trim().min(1),
  body: z.string().trim().min(1),
});

export async function pinNoteAction(input: unknown): Promise<StaffActionResult> {
  const parsed = noteSchema.safeParse(input);
  if (!parsed.success) return { ok: false, message: "Please give the note a title and some text." };
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("community_clinician_pin", {
    p_group_id: parsed.data.groupId,
    p_title: parsed.data.title,
    p_body: parsed.data.body,
  });
  const result = toResult(data, error, { ok: "Your note was saved. It shows to members once a different clinician reviews it." }, {
    "23514": "The title needs at least 3 characters, and the note cannot be empty or too long.",
    "42501": "Only an active clinician can write a note.",
  });
  if (result.ok) refresh();
  return result;
}

export async function reviewPinAction(input: unknown): Promise<StaffActionResult> {
  const parsed = z.object({ id: z.string().uuid() }).safeParse(input);
  if (!parsed.success) return INVALID;
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("community_clinician_review_pin", { p_id: parsed.data.id });
  const result = toResult(data, error, { ok: "Reviewed. Your name and today's date now show on the note." });
  if (result.ok) refresh();
  return result;
}

const drillSchema = z
  .object({
    passed: z.boolean(),
    notes: z.string().trim().max(DRILL_NOTES_MAX).optional(),
    steps: z
      .array(z.object({ step: z.enum(DRILL_STEPS), ok: z.boolean() }))
      .length(DRILL_STEPS.length),
  })
  .refine((v) => !v.passed || v.steps.slice(0, DRILL_REQUIRED_STEPS).every((s) => s.ok), { message: "a pass needs the first steps" });

/** Records one run of the safety drill. Only the Chief Medical Officer is allowed; the database checks that. */
export async function recordDrillAction(input: unknown): Promise<StaffActionResult> {
  const parsed = drillSchema.safeParse(input);
  if (!parsed.success) return INVALID;
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("community_record_tabletop", {
    p_passed: parsed.data.passed,
    p_steps: parsed.data.steps,
    ...(parsed.data.notes ? { p_notes: parsed.data.notes } : {}),
  });
  const result = toResult(data, error, { ok: "Recorded. The drill has been added to the list of runs." }, {
    "42501": "Only the Chief Medical Officer can record a drill.",
  });
  if (result.ok) {
    revalidatePath(PATH);
    revalidatePath("/admin/community/drill");
    revalidatePath("/clinician/community/drill");
  }
  return result;
}

const DPO_ERRORS = { "42501": "Only the Chief Medical Officer can change who is told about member lookups." } as const;

/**
 * The Chief Medical Officer adds or removes someone from the list of people told when a member's name is looked up. Optional: the CMO is
 * always told, and nothing about switching Community on depends on this list.
 */
export async function setDpoRecipientAction(input: unknown): Promise<StaffActionResult> {
  const parsed = z.object({ profileId: z.string().uuid(), on: z.boolean() }).safeParse(input);
  if (!parsed.success) return INVALID;
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("community_admin_set_dpo", { p_profile_id: parsed.data.profileId, p_on: parsed.data.on });
  const result = toResult(
    data,
    error,
    { ok: parsed.data.on ? "Added. This person will be told about every member lookup." : "Removed. This person will no longer be told." },
    DPO_ERRORS,
  );
  if (!result.ok && !error && /no member matches/i.test(result.message)) {
    return { ok: false, message: "That person cannot be added. Only active staff can be told about member lookups." };
  }
  if (result.ok) refresh();
  return result;
}

const ATTEST_CODES = ["crisis_owner_named", "consent_text_approved", "clinical_safety_case_current"] as const;
const ATTEST_MIN_CHARS = { crisis_owner_named: 10, consent_text_approved: 10, clinical_safety_case_current: 25 } as const;

/**
 * The Chief Medical Officer records one of the three statements only a person can make before Community can be switched on: who owns the
 * self-harm queue, that the consent text is approved, and that the clinical safety case is current. This is the same database function the
 * go-live page uses (attest_go_live_condition), which checks that the signed-in person is the CMO and writes their name and the time. The
 * note must say what was checked and by whom. Nothing here switches Community on.
 */
export async function attestCommunityConditionAction(input: unknown): Promise<StaffActionResult> {
  const parsed = z.object({ code: z.enum(ATTEST_CODES), note: z.string().trim().min(10).max(1000) }).safeParse(input);
  if (!parsed.success) return { ok: false, message: "Please write a sentence saying what was checked and by whom." };
  if (parsed.data.note.length < ATTEST_MIN_CHARS[parsed.data.code]) {
    return {
      ok: false,
      message:
        parsed.data.code === "clinical_safety_case_current"
          ? "Name the safety case document, its version and who signed it."
          : "Please write a sentence saying what was checked and by whom.",
    };
  }
  // attest_go_live_condition belongs to the go-live module and is not in the generated Community types, so it is called the way that module does.
  const supabase = (await createClient()) as unknown as RpcClient;
  const { error } = await supabase.rpc("attest_go_live_condition", {
    p_key: "community",
    p_code: parsed.data.code,
    p_met: true,
    p_note: parsed.data.note,
  });
  if (error) {
    return {
      ok: false,
      message: failureMessage(error, {
        "42501": "Only the Chief Medical Officer can record this.",
        "22023": "That was not accepted. Please check the note and try again.",
      }),
    };
  }
  refresh();
  revalidatePath("/clinician/go-live");
  return { ok: true, message: "Recorded with your name and today's date." };
}
