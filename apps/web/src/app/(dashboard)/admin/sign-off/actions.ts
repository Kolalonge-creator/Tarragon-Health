"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { getCurrentProfile } from "@/lib/auth/current-profile";
import { getCallerPermissions } from "@/lib/auth/permissions";
import { createClient } from "@/lib/supabase/server";
import { fdRpc } from "@/lib/frontdesk/raw-db";
import { knowledgeFingerprint, stepFingerprint } from "@/lib/frontdesk/signoff-model";
import { readPendingFrontDeskSignoff } from "@/lib/queries/pending-front-desk-signoff";

export type SignoffActionState = { error?: string; done?: string } | undefined;

const uuid = z.string().uuid();
/** "<id>:<fingerprint of the wording the reader saw>" */
const approval = z.string().regex(/^[0-9a-f-]{36}:[0-9a-f]{8}$/);

async function requireSuperAdmin(): Promise<string | null> {
  const profile = await getCurrentProfile();
  if (!profile) return "Not signed in";
  // The database re-checks private.is_admin(); this is the friendly message, not the gate.
  const { isSuperAdmin } = await getCallerPermissions();
  return isSuperAdmin ? null : "Only an admin can approve wording";
}

function refresh() {
  revalidatePath("/admin/sign-off");
  revalidatePath("/admin");
}

type Kind = "step" | "knowledge";

/**
 * Approves one item or several. Every item arrives with a fingerprint of the exact wording the reader was shown; the wording is re-read here
 * and an item whose text has since changed is refused (not approved), so nothing is ever approved unseen. Items already approved are skipped.
 */
async function approveItems(kind: Kind, entries: readonly string[]): Promise<SignoffActionState> {
  const denied = await requireSuperAdmin();
  if (denied) return { error: denied };
  if (entries.length === 0) return { error: "Nothing selected" };
  if (entries.length > 100) return { error: "Too many items in one go" };

  const supabase = await createClient();
  const current = await readPendingFrontDeskSignoff(supabase);
  if (current.failed) return { error: "The current wording could not be read, so nothing was approved. Reload and try again." };

  let approved = 0;
  const changed: string[] = [];
  for (const entry of entries) {
    const [id, fp] = entry.split(":") as [string, string];
    const row = kind === "step" ? current.steps.find((s) => s.id === id) : current.knowledge.find((k) => k.id === id);
    if (!row) return { error: "An item no longer exists. Reload the page." };
    if (kind === "step" ? (row as (typeof current.steps)[number]).status === "approved" : (row as (typeof current.knowledge)[number]).approvedAt !== null) continue;
    const seen = kind === "step" ? stepFingerprint(row as (typeof current.steps)[number]) : knowledgeFingerprint(row as (typeof current.knowledge)[number]);
    if (seen !== fp) {
      changed.push(kind === "step" ? (row as (typeof current.steps)[number]).stepKey : (row as (typeof current.knowledge)[number]).topic);
      continue;
    }
    const { error } = await fdRpc(supabase, kind === "step" ? "fd_approve_sequence_step" : "fd_approve_knowledge", kind === "step" ? { p_step_id: id } : { p_id: id });
    if (error) return { error: `Could not approve: ${error}. ${approved} approved before this.` };
    approved += 1;
  }
  refresh();
  if (changed.length > 0) {
    return { error: `${changed.join(", ")} changed after you opened this page, so ${changed.length === 1 ? "it was" : "they were"} not approved. Read the new wording and approve again.` };
  }
  return { done: approved === 0 ? "Nothing needed approving" : `${approved} approved` };
}

async function approveOne(kind: Kind, formData: FormData): Promise<SignoffActionState> {
  const parsed = approval.safeParse(formData.get("approval"));
  if (!parsed.success) return { error: "Invalid request" };
  return approveItems(kind, [parsed.data]);
}

export async function approveStepAction(_prev: SignoffActionState, formData: FormData): Promise<SignoffActionState> {
  return approveOne("step", formData);
}

export async function approveKnowledgeAction(_prev: SignoffActionState, formData: FormData): Promise<SignoffActionState> {
  return approveOne("knowledge", formData);
}

const approveAllSchema = z.object({
  confirm: z.literal("on", { message: "Tick the box to confirm you have read every item" }),
  steps: z.array(approval).max(100),
  knowledge: z.array(approval).max(100),
});

export async function approveAllAction(_prev: SignoffActionState, formData: FormData): Promise<SignoffActionState> {
  const parsed = approveAllSchema.safeParse({
    confirm: formData.get("confirm"),
    steps: formData.getAll("step"),
    knowledge: formData.getAll("knowledge"),
  });
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Invalid request" };
  const a = await approveItems("step", parsed.data.steps);
  if (a?.error && parsed.data.steps.length > 0) return a;
  if (parsed.data.knowledge.length === 0) return a;
  const b = await approveItems("knowledge", parsed.data.knowledge);
  if (b?.error) return b;
  return { done: [a?.done, b?.done].filter(Boolean).join("; ") };
}

const saveStepSchema = z.object({
  id: uuid,
  subject: z.string().trim().min(3).max(150),
  body: z.string().trim().min(20).max(4000),
});

export async function saveStepAction(_prev: SignoffActionState, formData: FormData): Promise<SignoffActionState> {
  const denied = await requireSuperAdmin();
  if (denied) return { error: denied };
  const parsed = saveStepSchema.safeParse({ id: formData.get("id"), subject: formData.get("subject"), body: formData.get("body") });
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Invalid request" };
  const supabase = await createClient();
  const { error } = await fdRpc(supabase, "fd_save_sequence_step", { p_step_id: parsed.data.id, p_subject: parsed.data.subject, p_body_text: parsed.data.body });
  if (error) return { error: error.includes("23514") || /check/i.test(error) ? "That wording uses a placeholder other than {{first_name}} or {{link}}." : error };
  refresh();
  return { done: "Saved. It now needs approving again." };
}

const saveKnowledgeSchema = z.object({
  topic: z.string().regex(/^[a-z0-9_]{3,60}$/),
  content: z.string().trim().min(20).max(4000),
});

export async function saveKnowledgeAction(_prev: SignoffActionState, formData: FormData): Promise<SignoffActionState> {
  const denied = await requireSuperAdmin();
  if (denied) return { error: denied };
  const parsed = saveKnowledgeSchema.safeParse({ topic: formData.get("topic"), content: formData.get("content") });
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Invalid request" };
  const supabase = await createClient();
  const { error } = await fdRpc(supabase, "fd_save_knowledge", { p_topic: parsed.data.topic, p_content: parsed.data.content });
  if (error) return { error: /check/i.test(error) ? "That wording uses a placeholder that is not allowed." : error };
  refresh();
  return { done: "Saved as a new version. It now needs approving." };
}
