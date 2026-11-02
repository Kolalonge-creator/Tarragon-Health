"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { getCurrentProfile } from "@/lib/auth/current-profile";
import { hasPermission } from "@/lib/auth/permissions";
import { createClient } from "@/lib/supabase/server";
import { fdRpc } from "@/lib/frontdesk/raw-db";

export type InboxActionState = { error?: string; done?: string } | undefined;

async function requireStaff(): Promise<string | null> {
  const profile = await getCurrentProfile();
  if (!profile) return "Not signed in";
  // The database re-checks (private.fd_require_staff); this is the friendly message, not the gate.
  return (await hasPermission("leads.manage")) ? null : "You don't have access to do that";
}

const replySchema = z.object({
  handoffId: z.string().uuid(),
  reply: z.string().trim().min(1, "Write a reply first").max(4000, "That reply is too long"),
});

/** Queues the reply: the dispatcher emails it to the visitor within a minute. The database records whether the suggested wording was edited. */
export async function queueReplyAction(_prev: InboxActionState, formData: FormData): Promise<InboxActionState> {
  const denied = await requireStaff();
  if (denied) return { error: denied };
  const parsed = replySchema.safeParse({ handoffId: formData.get("handoffId"), reply: formData.get("reply") });
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Invalid request" };
  const { error } = await fdRpc(await createClient(), "fd_handoff_queue_reply", { p_handoff: parsed.data.handoffId, p_text: parsed.data.reply });
  if (error) return { error: /already on its way/.test(error) ? "A reply is already on its way." : /no email|nowhere to send/.test(error) ? "This visitor left no email address, so there is nowhere to send a reply." : /not to be contacted|asked not/.test(error) ? "This person asked not to be contacted." : error };
  revalidatePath("/admin/inbox");
  return { done: "Reply queued. It will be emailed shortly." };
}

const closeSchema = z.object({ handoffId: z.string().uuid() });

export async function closeHandoffAction(_prev: InboxActionState, formData: FormData): Promise<InboxActionState> {
  const denied = await requireStaff();
  if (denied) return { error: denied };
  const parsed = closeSchema.safeParse({ handoffId: formData.get("handoffId") });
  if (!parsed.success) return { error: "Invalid request" };
  const { error } = await fdRpc(await createClient(), "fd_handoff_close", { p_handoff: parsed.data.handoffId });
  if (error) return { error };
  revalidatePath("/admin/inbox");
  return { done: "Closed" };
}
