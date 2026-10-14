"use server";

import { z } from "zod";
import { getCurrentClinicalStaff } from "@/lib/auth/current-profile";
import { createClient } from "@/lib/supabase/server";
import { loose } from "@/lib/clinician/loose-client";
import { anonymousStatusSchema, idSchema, type AnonymousStatus } from "./model";

/**
 * S20 v2 anonymous speak-up. The follow-up code is the only way back; it is shown once on the screen that created it and is never put in
 * an address, a log line or an error. These actions return a small state object (no redirect), because the answer is read on the same
 * screen. A database error text is never passed on: the state carries a fixed token.
 */
export type AnonymousLookupState = { status?: AnonymousStatus; error?: "not_found" | "failed" } | undefined;
export type AnonymousStep = { done?: true; error?: "failed" } | undefined;

const code = z.string().trim().min(8).max(40);
const clinicianOnly = async (): Promise<boolean> => (await getCurrentClinicalStaff()) !== null;

export async function lookupAnonymousConcern(_prev: AnonymousLookupState, formData: FormData): Promise<AnonymousLookupState> {
  if (!(await clinicianOnly())) return { error: "failed" };
  const c = code.safeParse(formData.get("code"));
  if (!c.success) return { error: "not_found" };
  const { data, error } = await loose(await createClient()).rpc("anonymous_concern_status", { p_code: c.data });
  if (error) return { error: error.code === "P0002" ? "not_found" : "failed" };
  const parsed = anonymousStatusSchema.safeParse(data);
  return parsed.success ? { status: parsed.data } : { error: "failed" };
}

export async function addToAnonymousConcern(_prev: AnonymousStep, formData: FormData): Promise<AnonymousStep> {
  if (!(await clinicianOnly())) return { error: "failed" };
  const c = code.safeParse(formData.get("code"));
  const body = z.string().trim().min(5).max(4000).safeParse(formData.get("body"));
  if (!c.success || !body.success) return { error: "failed" };
  const { error } = await loose(await createClient()).rpc("add_to_anonymous_concern", { p_code: c.data, p_body: body.data });
  return error ? { error: "failed" } : { done: true };
}

export async function answerAnonymousCheckin(_prev: AnonymousStep, formData: FormData): Promise<AnonymousStep> {
  if (!(await clinicianOnly())) return { error: "failed" };
  const c = code.safeParse(formData.get("code"));
  const checkin = idSchema.safeParse(formData.get("checkin"));
  const answer = z.enum(["fine", "problem"]).safeParse(formData.get("answer"));
  const note = z.string().trim().max(2000).safeParse(String(formData.get("note") ?? ""));
  if (!c.success || !checkin.success || !answer.success || !note.success) return { error: "failed" };
  const { error } = await loose(await createClient()).rpc("answer_concern_checkin", { p_checkin: checkin.data, p_answer: answer.data, p_note: note.data === "" ? null : note.data, p_code: c.data });
  return error ? { error: "failed" } : { done: true };
}
