"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { loose } from "@/lib/clinician/loose-client";
import { createFormSchema, createResultSchema, type CreateState, type Notice } from "./model";

const PATH = "/admin/settings/signup-invites";
const back = (n: Notice): never => redirect(`${PATH}?n=${n}`);
const denied = (e: { code?: string; message: string }) => e.code === "42501" || /not authorised|only an admin/i.test(e.message);

/** Creates an invite. A code comes back exactly once, in this answer; it is stored only as a hash and can never be shown again. */
export async function createInviteAction(_prev: CreateState, formData: FormData): Promise<CreateState> {
  const parsed = createFormSchema.safeParse({
    kind: formData.get("kind"),
    value: String(formData.get("value") ?? ""),
    label: String(formData.get("label") ?? ""),
    maxUses: formData.get("maxUses") || undefined,
    days: formData.get("days") || undefined,
  });
  if (!parsed.success) return { error: "Check the phone number (with country code, like +2348012345678) or email, and give a reason of at least 3 characters." };
  const v = parsed.data;
  const { data, error } = await loose(await createClient()).rpc("create_signup_invite", {
    p_kind: v.kind,
    p_value: v.kind === "code" ? null : v.value,
    p_label: v.label,
    p_max_uses: v.maxUses,
    p_days: v.days,
  });
  if (error) return { error: denied(error) ? "Only an admin can manage sign-up invites." : "That could not be saved. That phone or email may already have an open invite." };
  const result = createResultSchema.safeParse(data);
  if (!result.success) return { error: "That could not be saved." };
  revalidatePath(PATH);
  return { ok: true, code: result.data.code ?? undefined };
}

export async function revokeInviteAction(formData: FormData): Promise<void> {
  const id = String(formData.get("id") ?? "");
  if (!/^[0-9a-f-]{36}$/i.test(id)) return back("failed");
  const { error } = await loose(await createClient()).rpc("revoke_signup_invite", { p_id: id });
  if (error) return back(denied(error) ? "denied" : "failed");
  return back("revoked");
}

/** Turns invite-only sign-up on or off. Audited by the database; off means anyone can sign up. */
export async function setInviteOnlyAction(formData: FormData): Promise<void> {
  const on = formData.get("on") === "true";
  const { error } = await loose(await createClient()).rpc("set_platform_switch", {
    p_key: "signup_invites_required",
    p_on: on,
    p_note: on ? "Invite-only sign-up switched on from the admin screen" : "Invite-only sign-up switched off from the admin screen",
  });
  if (error) return back(denied(error) ? "denied" : "failed");
  return back("switched");
}
