"use server";

import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { loose } from "@/lib/clinician/loose-client";
import { ownerFormSchema, type Notice } from "./model";

const back = (n: Notice): never => redirect(`/admin/ops/automations?n=${n}`);

/** Sets who owns a scheduled job. The database checks the caller is an admin and refuses a job left without an owner. */
export async function setAutomationOwnerAction(formData: FormData): Promise<void> {
  const parsed = ownerFormSchema.safeParse({
    id: formData.get("id"),
    owner_role: formData.get("owner_role"),
    runbook_url: String(formData.get("runbook_url") ?? "").trim(),
    interval: String(formData.get("interval") ?? "").trim(),
  });
  if (!parsed.success) return back("failed");
  const { error } = await loose(await createClient()).rpc("set_automation_owner", {
    p_id: parsed.data.id,
    p_owner_role: parsed.data.owner_role,
    p_owner_user: null,
    p_runbook_url: parsed.data.runbook_url,
    p_expected_interval_minutes: parsed.data.interval,
  });
  if (error) return back(error.code === "42501" ? "denied" : "failed");
  return back("saved");
}
