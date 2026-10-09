"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { staffRefusalText, outcomeSchema } from "@/lib/community/model";
import { friendlyDbError } from "./errors";
import { getRpcClient } from "./rpc";
import type { ActionState } from "./state";
import {
  createGroupSchema, editGroupSchema, groupStatusSchema, topicSchema, grantSchema, revokeSchema, versionSchema, newDraftSchema,
  ruleSaveSchema, ruleDeleteSchema, hostsSchema, unmaskSchema, unpinSchema, groupCapSchema, savePromptSchema, endPromptSchema,
} from "./schemas";

/**
 * Server actions for /admin/community. Authorisation is the database's job: every function checks auth.uid() itself, so nothing here
 * trusts a role sent from the browser. Each action validates its input, calls one function, parses the reply, and answers in plain
 * English. Raw database text is never returned.
 */
const BASE = "/admin/community";
const GENERIC = "That could not be done. Please try again.";

const text = (f: FormData, k: string): string => {
  const v = f.get(k);
  return typeof v === "string" ? v : "";
};
const flag = (f: FormData, k: string): boolean => f.get(k) === "on" || f.get(k) === "true";
const firstIssue = (e: z.ZodError): string => e.issues[0]?.message || "Please check the form and try again.";

async function run(fn: string, args: Record<string, unknown>, okText: string, paths: string[]): Promise<ActionState & { data?: unknown }> {
  const client = await getRpcClient();
  const { data, error } = await client.rpc(fn, args);
  if (error) return { ok: false, message: friendlyDbError(error) };
  const parsed = outcomeSchema.safeParse(data);
  if (!parsed.success) return { ok: false, message: GENERIC };
  if (parsed.data.status === "refused") return { ok: false, message: staffRefusalText(parsed.data.reason) };
  if (parsed.data.status !== "ok") return { ok: false, message: GENERIC };
  for (const p of paths) revalidatePath(p);
  return { ok: true, message: okText, data: parsed.data };
}

export async function createGroupAction(_prev: ActionState, f: FormData): Promise<ActionState> {
  const p = createGroupSchema.safeParse(Object.fromEntries(["name", "slug", "description", "topic_code", "rules_text"].map((k) => [k, text(f, k)])));
  if (!p.success) return { ok: false, message: firstIssue(p.error) };
  const r = await run("community_admin_save_group", {
    p_id: null, p_name: p.data.name, p_slug: p.data.slug, p_description: p.data.description, p_topic_code: p.data.topic_code,
    p_rules_text: p.data.rules_text, p_join_mode: "open", p_status: null,
  }, "The group was created as a draft. It is not visible to members until you make it live.", [`${BASE}/groups`, BASE]);
  return { ok: r?.ok ?? false, message: r?.message ?? GENERIC };
}

export async function editGroupAction(_prev: ActionState, f: FormData): Promise<ActionState> {
  const p = editGroupSchema.safeParse(Object.fromEntries(["id", "slug", "name", "description", "topic_code", "rules_text"].map((k) => [k, text(f, k)])));
  if (!p.success) return { ok: false, message: firstIssue(p.error) };
  const r = await run("community_admin_save_group", {
    p_id: p.data.id, p_name: p.data.name, p_slug: p.data.slug, p_description: p.data.description, p_topic_code: p.data.topic_code,
    p_rules_text: p.data.rules_text, p_join_mode: null, p_status: null,
  }, "Saved.", [`${BASE}/groups`, BASE]);
  return { ok: r?.ok ?? false, message: r?.message ?? GENERIC };
}

export async function setGroupStatusAction(_prev: ActionState, f: FormData): Promise<ActionState> {
  const p = groupStatusSchema.safeParse({ id: text(f, "id"), slug: text(f, "slug"), status: text(f, "status") });
  if (!p.success) return { ok: false, message: firstIssue(p.error) };
  const done = { active: "The group is now live.", read_only: "The group is now read only.", archived: "The group is archived." }[p.data.status];
  const r = await run("community_admin_save_group", {
    p_id: p.data.id, p_name: "", p_slug: p.data.slug, p_description: null, p_topic_code: null, p_rules_text: null, p_join_mode: null, p_status: p.data.status,
  }, done, [`${BASE}/groups`, BASE]);
  return { ok: r?.ok ?? false, message: r?.message ?? GENERIC };
}

export async function saveTopicAction(_prev: ActionState, f: FormData): Promise<ActionState> {
  const p = topicSchema.safeParse({
    code: text(f, "code"), label: text(f, "label"), description: text(f, "description"), sort_order: text(f, "sort_order") || "100",
    is_active: flag(f, "is_active"), requires_cmo_rules: flag(f, "requires_cmo_rules"),
  });
  if (!p.success) return { ok: false, message: firstIssue(p.error) };
  const r = await run("community_admin_save_topic", {
    p_code: p.data.code, p_label: p.data.label, p_description: p.data.description, p_sort_order: p.data.sort_order,
    p_is_active: p.data.is_active, p_requires_cmo_rules: p.data.requires_cmo_rules,
  }, "Topic saved.", [`${BASE}/topics`, `${BASE}/groups`]);
  return { ok: r?.ok ?? false, message: r?.message ?? GENERIC };
}

export async function grantStaffAction(_prev: ActionState, f: FormData): Promise<ActionState> {
  const pasted = text(f, "profile_id_pasted").trim();
  const p = grantSchema.safeParse({ profile_id: pasted || text(f, "profile_id"), scope: text(f, "scope"), group_id: text(f, "group_id") });
  if (!p.success) return { ok: false, message: "Please choose a staff member and a permission." };
  const r = await run("community_admin_grant_staff", { p_profile_id: p.data.profile_id, p_scope: p.data.scope, p_group_id: p.data.group_id },
    "Permission given.", [`${BASE}/staff`, BASE]);
  return { ok: r?.ok ?? false, message: r?.message ?? GENERIC };
}

export async function revokeStaffAction(_prev: ActionState, f: FormData): Promise<ActionState> {
  const p = revokeSchema.safeParse({ id: text(f, "id") });
  if (!p.success) return { ok: false, message: GENERIC };
  const r = await run("community_admin_revoke_staff", { p_id: p.data.id }, "Permission ended.", [`${BASE}/staff`, BASE]);
  return { ok: r?.ok ?? false, message: r?.message ?? GENERIC };
}

export async function newDraftAction(_prev: ActionState, f: FormData): Promise<ActionState> {
  const p = newDraftSchema.safeParse({ from_version: text(f, "from_version") });
  if (!p.success) return { ok: false, message: GENERIC };
  const r = await run("community_admin_rule_set_create", { p_from_version: p.data.from_version }, "A new draft was started.", [`${BASE}/rules`, BASE]);
  return { ok: r?.ok ?? false, message: r?.message ?? GENERIC };
}

export async function saveRuleAction(_prev: ActionState, f: FormData): Promise<ActionState> {
  const p = ruleSaveSchema.safeParse(Object.fromEntries(["version", "class", "kind", "pattern", "action"].map((k) => [k, text(f, k)])));
  if (!p.success) return { ok: false, message: firstIssue(p.error) };
  const r = await run("community_admin_rule_save", {
    p_version: p.data.version, p_class: p.data.class, p_kind: p.data.kind, p_pattern: p.data.pattern, p_action: p.data.action, p_note: null,
  }, "Rule saved.", [`${BASE}/rules`]);
  return { ok: r?.ok ?? false, message: r?.message ?? GENERIC };
}

export async function deleteRuleAction(_prev: ActionState, f: FormData): Promise<ActionState> {
  const p = ruleDeleteSchema.safeParse({ version: text(f, "version"), rule_id: text(f, "rule_id") });
  if (!p.success) return { ok: false, message: GENERIC };
  const r = await run("community_admin_rule_delete", { p_rule_id: p.data.rule_id }, "Rule removed.", [`${BASE}/rules`]);
  return { ok: r?.ok ?? false, message: r?.message ?? GENERIC };
}

export async function saveHostsAction(_prev: ActionState, f: FormData): Promise<ActionState> {
  const p = hostsSchema.safeParse({ version: text(f, "version"), hosts: text(f, "hosts") });
  if (!p.success) return { ok: false, message: GENERIC };
  const r = await run("community_admin_rule_set_params", { p_version: p.data.version, p_allowed_hosts: p.data.hosts }, "Allowed link hostnames saved.", [`${BASE}/rules`]);
  return { ok: r?.ok ?? false, message: r?.message ?? GENERIC };
}

export async function activateRuleSetAction(_prev: ActionState, f: FormData): Promise<ActionState> {
  const p = versionSchema.safeParse({ version: text(f, "version") });
  if (!p.success) return { ok: false, message: GENERIC };
  const r = await run("community_admin_rule_set_activate", { p_version: p.data.version }, `Version ${p.data.version} is now the live rule set.`, [`${BASE}/rules`, BASE]);
  return { ok: r?.ok ?? false, message: r?.message ?? GENERIC };
}

const unmaskReplySchema = z.object({ status: z.string(), reason: z.string().optional(), profile_id: z.string().optional(), full_name: z.string().nullable().optional() }).passthrough();

/** The one place a member's name is resolved. The reply is returned once to the page that asked and is not stored anywhere by us. */
export async function unmaskAction(_prev: ActionState, f: FormData): Promise<ActionState> {
  const p = unmaskSchema.safeParse({ group_id: text(f, "group_id"), handle: text(f, "handle"), reason: text(f, "reason") });
  if (!p.success) return { ok: false, message: firstIssue(p.error) };
  const client = await getRpcClient();
  const { data, error } = await client.rpc("community_admin_unmask", { p_group_id: p.data.group_id, p_handle: p.data.handle, p_reason: p.data.reason });
  if (error) return { ok: false, message: friendlyDbError(error) };
  const parsed = unmaskReplySchema.safeParse(data);
  if (!parsed.success) return { ok: false, message: GENERIC };
  if (parsed.data.status === "refused") return { ok: false, message: staffRefusalText(parsed.data.reason) };
  if (parsed.data.status !== "ok" || !parsed.data.profile_id) return { ok: false, message: GENERIC };
  return {
    ok: true,
    message: "The lookup was recorded in the audit log with your written reason, without the member's name, and the Chief Medical Officer has been told.",
    result: { profile_id: parsed.data.profile_id, full_name: parsed.data.full_name ?? null },
  };
}

export async function unpinAction(_prev: ActionState, f: FormData): Promise<ActionState> {
  const p = unpinSchema.safeParse({ id: text(f, "id"), group_id: text(f, "group_id") });
  if (!p.success) return { ok: false, message: GENERIC };
  const r = await run("community_admin_unpin", { p_id: p.data.id }, "The note is no longer pinned.", [`${BASE}/pinned`]);
  return { ok: r?.ok ?? false, message: r?.message ?? GENERIC };
}

export async function setGroupCapAction(_prev: ActionState, f: FormData): Promise<ActionState> {
  const p = groupCapSchema.safeParse({ id: text(f, "id"), cap: text(f, "cap") });
  if (!p.success) return { ok: false, message: firstIssue(p.error) };
  const r = await run("community_admin_set_group_cap", { p_id: p.data.id, p_cap: p.data.cap },
    p.data.cap === null ? "The size limit was removed." : `The largest size is now ${p.data.cap} members.`, [`${BASE}/groups`]);
  return { ok: r?.ok ?? false, message: r?.message ?? GENERIC };
}

export async function savePromptAction(_prev: ActionState, f: FormData): Promise<ActionState> {
  const p = savePromptSchema.safeParse({ group_id: text(f, "group_id"), body: text(f, "body"), show_from: text(f, "show_from"), show_until: text(f, "show_until") });
  if (!p.success) return { ok: false, message: firstIssue(p.error) };
  const r = await run("community_admin_save_prompt", {
    p_group_id: p.data.group_id, p_body: p.data.body, p_show_from: p.data.show_from, p_show_until: p.data.show_until,
  }, "The prompt was added.", [`${BASE}/prompts`]);
  return { ok: r?.ok ?? false, message: r?.message ?? GENERIC };
}

export async function endPromptAction(_prev: ActionState, f: FormData): Promise<ActionState> {
  const p = endPromptSchema.safeParse({ id: text(f, "id") });
  if (!p.success) return { ok: false, message: GENERIC };
  const r = await run("community_admin_end_prompt", { p_id: p.data.id }, "The prompt has ended.", [`${BASE}/prompts`]);
  return { ok: r?.ok ?? false, message: r?.message ?? GENERIC };
}
