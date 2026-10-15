"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { taskTypeProposalSchema, toProposalRpcArgs } from "./task-type-proposal";

/**
 * Propose a new task type (S76 B4). Admin and the Chief Medical Officer both have this form; the database decides who may
 * (42501) and its 22023 messages are written for people. The type is created unconfirmed: confirming stays the CMO's own act.
 */
const ALLOWED = ["/clinician/task-types", "/admin/task-types"] as const;

function back(path: string, key: "done" | "error", value: string): never {
  redirect(`${path}?${key}=${encodeURIComponent(value)}`);
}

export async function createTaskTypeProposalAction(formData: FormData): Promise<void> {
  const raw = formData.get("returnTo");
  const path = ALLOWED.find((p) => p === raw) ?? ALLOWED[0];
  const parsed = taskTypeProposalSchema.safeParse({
    code: formData.get("code") ?? "",
    priorityClass: formData.get("priorityClass") ?? "",
    defaultDueMinutes: formData.get("defaultDueMinutes") ?? "",
    minTier: formData.get("minTier") ?? "",
    requiredCompetencies: String(formData.get("requiredCompetencies") ?? ""),
    leadWindowMinutes: formData.get("leadWindowMinutes") ?? "0",
    claimTimeoutMinutes: formData.get("claimTimeoutMinutes") ?? "30",
    pushable: formData.get("pushable") !== null,
    sourceTaskKeys: String(formData.get("sourceTaskKeys") ?? ""),
    note: String(formData.get("note") ?? ""),
  });
  if (!parsed.success) back(path, "error", parsed.error.issues[0]?.message ?? "Check the form and try again.");
  const supabase = await createClient();
  const { error } = await (supabase as unknown as { rpc(fn: string, args: Record<string, unknown>): PromiseLike<{ error: { message: string; code?: string } | null }> })
    .rpc("create_task_type_proposal", toProposalRpcArgs(parsed.data));
  if (error) back(path, "error", error.code === "22023" || error.code === "42501" ? error.message : "Something went wrong. Nothing was created.");
  revalidatePath(path);
  back(path, "done", "Proposed. It waits for the Chief Medical Officer to confirm it.");
}
