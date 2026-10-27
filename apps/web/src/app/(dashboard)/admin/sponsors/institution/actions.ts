"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { rpcLoose } from "@/lib/institution/rpc";

const uuid = z.string().uuid();

export async function reviewConfigAction(form: FormData): Promise<void> {
  const id = uuid.safeParse(form.get("id"));
  if (!id.success) redirect("/admin/sponsors/institution?m=invalid");
  const approve = form.get("decision") === "approve";
  const { error } = await rpcLoose("admin_review_institution_config", { p_id: id.data!, p_approve: approve, p_note: String(form.get("note") ?? "") });
  revalidatePath("/admin/sponsors/institution");
  redirect(`/admin/sponsors/institution?m=${error ? "invalid" : "reviewed"}`);
}

export async function linkStatementAction(form: FormData): Promise<void> {
  const st = uuid.safeParse(form.get("statement"));
  const inv = uuid.safeParse(form.get("invoice"));
  if (!st.success || !inv.success) redirect("/admin/sponsors/institution?m=invalid");
  const { error } = await rpcLoose("admin_link_usage_statement", { p_statement: st.data!, p_invoice: inv.data! });
  revalidatePath("/admin/sponsors/institution");
  redirect(`/admin/sponsors/institution?m=${error ? "invalid" : "linked"}`);
}
