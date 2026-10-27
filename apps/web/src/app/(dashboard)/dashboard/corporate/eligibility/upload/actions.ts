"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { getCurrentProfile } from "@/lib/auth/current-profile";
import { rpcLoose } from "@/lib/institution/rpc";
import { approvalReasonText, parseEligibilityFile, parseStageResult, UPLOAD_MODES } from "@/lib/institution/files";

export type StageState = { error?: string } | undefined;
export type StepState = { error?: string; message?: string } | undefined;

const uuid = z.string().uuid();

/** Stage a file: validate every row and show the plan. Nothing on the roster changes. */
export async function stageUploadAction(_prev: StageState, form: FormData): Promise<StageState> {
  const profile = await getCurrentProfile();
  if (!profile?.organisation_id) return { error: "Not authorised" };
  const mode = String(form.get("mode") ?? "");
  if (!(UPLOAD_MODES as readonly string[]).includes(mode)) return { error: "Choose add, remove or replace." };
  const file = form.get("file");
  let text = String(form.get("pasted") ?? "");
  let filename: string | null = null;
  if (file instanceof File && file.size > 0) {
    if (file.size > 2_000_000) return { error: "That file is too large. Split it into smaller files." };
    text = await file.text();
    filename = file.name;
  }
  const parsed = parseEligibilityFile(text);
  if (parsed.rows.length === 0) return { error: "No rows found. Paste your list or choose a file." };
  const { data, error } = await rpcLoose("employer_stage_roster_upload", { p_organisation_id: profile.organisation_id, p_mode: mode, p_rows: parsed.rows, p_filename: filename ?? "" });
  if (error) {
    if (error.message.includes("not yet activated")) return { error: "This is not switched on yet." };
    if (error.message.includes("roster_rows_invalid")) return { error: "The file has too many rows (the limit is 5,000) or is empty." };
    return { error: "The file could not be checked. Please try again." };
  }
  const staged = parseStageResult(data);
  if (!staged) return { error: "The file could not be checked. Please try again." };
  redirect(`/dashboard/corporate/eligibility/upload?batch=${staged.batch_id}`);
}

async function step(batch: string, fn: "employer_approve_roster_upload" | "employer_commit_roster_upload" | "employer_cancel_roster_upload"): Promise<StepState> {
  if (!uuid.safeParse(batch).success) return { error: "Not found" };
  const { data, error } = await rpcLoose(fn, { p_batch: batch });
  if (error) return { error: error.message.includes("roster_changed_since_staging") ? "Your list changed since this was checked. Nothing was applied. Upload the file again." : "That could not be done. Please try again." };
  revalidatePath("/dashboard/corporate/eligibility/upload");
  const r = data as { ok?: boolean; reason?: string; ended?: number } | boolean | null;
  if (r === true) return { message: "Cancelled." };
  if (r === false) return { error: "That upload can no longer be changed." };
  if (r && typeof r === "object" && r.ok === false) return { error: approvalReasonText(r.reason ?? "") };
  return { message: fn === "employer_commit_roster_upload" ? `Applied. ${r && typeof r === "object" && r.ended ? `${r.ended} people no longer covered; their own accounts are untouched.` : ""}` : "Approved. You can apply it now." };
}

export async function approveUploadAction(batch: string, _prev: StepState): Promise<StepState> {
  return step(batch, "employer_approve_roster_upload");
}
export async function commitUploadAction(batch: string, _prev: StepState): Promise<StepState> {
  return step(batch, "employer_commit_roster_upload");
}
export async function cancelUploadAction(batch: string, _prev: StepState): Promise<StepState> {
  return step(batch, "employer_cancel_roster_upload");
}
