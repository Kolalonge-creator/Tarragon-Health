"use server";

import { redirect } from "next/navigation";
import { z } from "zod";
import { getCurrentProfile } from "@/lib/auth/current-profile";
import { hasPermission } from "@/lib/auth/permissions";
import { createClient } from "@/lib/supabase/server";
import { loose } from "@/lib/clinician/loose-client";
import { approveFailureNotice, asViewer, PATHS, periodSchema, type Notice } from "./model";

/**
 * S36f server actions. The database is the protection (maker-checker, admin only approval, immutability); these checks only give a
 * clear message first and never trust the page. Each runs on the signed-in user's own session, never the service role, so the
 * database sees the real caller. No action here sends money.
 */
const idSchema = z.string().uuid();
const back = (viewer: keyof typeof PATHS, n: Notice): never => redirect(`${PATHS[viewer]}?n=${n}`);

export async function preparePayoutsAction(formData: FormData): Promise<void> {
  if (!(await hasPermission("payouts.prepare"))) return redirect("/admin");
  const period = periodSchema.safeParse({ start: formData.get("start"), end: formData.get("end") });
  if (!period.success) return back("ops", "prepare_failed");
  const { error } = await loose(await createClient()).rpc("prepare_payout_drafts", { p_period_start: period.data.start, p_period_end: period.data.end });
  return back("ops", error ? "prepare_failed" : "prepared");
}

export async function approvePayoutAction(formData: FormData): Promise<void> {
  const profile = await getCurrentProfile();
  if (profile?.role !== "admin") return redirect("/admin");
  const id = idSchema.safeParse(formData.get("payout"));
  const note = String(formData.get("note") ?? "").trim();
  if (!id.success || note.length < 10) return back("admin", "approve_failed");
  const { error } = await loose(await createClient()).rpc("approve_payout", { p_payout: id.data, p_note: note });
  return back("admin", error ? approveFailureNotice(error.message) : "approved");
}

export async function cancelPayoutAction(formData: FormData): Promise<void> {
  if (!(await hasPermission("payouts.prepare"))) return redirect("/admin");
  const viewer = asViewer(formData.get("viewer"));
  const id = idSchema.safeParse(formData.get("payout"));
  const reason = String(formData.get("reason") ?? "").trim();
  if (!id.success || reason.length < 10) return back(viewer, "cancel_failed");
  const { error } = await loose(await createClient()).rpc("cancel_payout", { p_payout: id.data, p_reason: reason });
  return back(viewer, error ? "cancel_failed" : "cancelled");
}
