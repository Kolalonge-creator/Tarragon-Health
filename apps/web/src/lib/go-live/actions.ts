"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { PROPOSED_CONFIG } from "@tarragon/shared";
import { createClient } from "@/lib/supabase/server";
import { getCurrentClinicalStaff, getCurrentProfile } from "@/lib/auth/current-profile";
import { canAssignCases } from "@/lib/clinical/doctor-tier";
import { findEntry, hashConfigValue, GUARD_KEYS, viewerOwns, type Viewer } from "./model";
import type { RpcClient } from "./load";

/**
 * S37 server actions for the go-live guard dashboard and the PROPOSED-config sign-off screen. They run only when a person presses
 * a button on /admin/go-live or /clinician/go-live. The database is the protection (set_go_live_guard, attest_go_live_condition
 * and record_proposed_config_signoff each check who is calling and refuse the wrong person with 42501); the checks here give a
 * clear message first. A message from the database for codes 22023 and 42501 is shown as written (it names what is missing);
 * anything else becomes a generic notice and nothing is changed.
 */
const PATHS = { admin: "/admin/go-live", cmo: "/clinician/go-live" } as const;
const noteSchema = z.string().trim().max(1000).optional();
const keySchema = z.enum(GUARD_KEYS);

type Back = { notice: string; detail?: string; failed: boolean };

function back(viewer: Viewer, r: Back): never {
  const q = new URLSearchParams({ notice: r.notice, ok: r.failed ? "0" : "1" });
  if (r.detail) q.set("detail", r.detail);
  redirect(`${PATHS[viewer]}?${q.toString()}`);
}

const fail = (viewer: Viewer, notice = "golive.error.generic", detail?: string): never => back(viewer, { notice, detail, failed: true });

function readable(error: { message: string; code?: string }): { notice: string; detail?: string } {
  return error.code === "22023" || error.code === "42501" ? { notice: "golive.error.generic", detail: error.message } : { notice: "golive.error.generic" };
}

async function who(raw: FormDataEntryValue | null): Promise<Viewer | null> {
  const viewer = raw === "admin" ? "admin" : raw === "cmo" ? "cmo" : null;
  if (!viewer) return null;
  if (viewer === "admin") return (await getCurrentProfile())?.role === "admin" ? "admin" : null;
  return canAssignCases(await getCurrentClinicalStaff()) ? "cmo" : null;
}

async function client(): Promise<RpcClient> {
  return (await createClient()) as unknown as RpcClient;
}

export async function switchGuardAction(formData: FormData): Promise<void> {
  const viewer = await who(formData.get("viewer"));
  if (!viewer) redirect("/");
  const key = keySchema.safeParse(formData.get("key"));
  const on = formData.get("on") === "1";
  const note = noteSchema.safeParse(formData.get("note") ?? undefined);
  if (!key.success || !note.success) return fail(viewer, "golive.error.input");
  const { error } = await (await client()).rpc("set_go_live_guard", { p_key: key.data, p_on: on, p_note: note.data || null });
  if (error) {
    const r = readable(error);
    return fail(viewer, r.notice, r.detail);
  }
  revalidatePath(PATHS[viewer]);
  return back(viewer, { notice: on ? "golive.done.switched_on" : "golive.done.switched_off", failed: false });
}

export async function attestConditionAction(formData: FormData): Promise<void> {
  const viewer = await who(formData.get("viewer"));
  if (!viewer) redirect("/");
  const key = keySchema.safeParse(formData.get("key"));
  const code = z.string().regex(/^[a-z][a-z0-9_]*$/).safeParse(formData.get("code"));
  const met = formData.get("met") === "1";
  const note = z.string().trim().min(10).max(1000).safeParse(formData.get("note"));
  if (!key.success || !code.success || !note.success) return fail(viewer, "golive.error.input");
  const { error } = await (await client()).rpc("attest_go_live_condition", { p_key: key.data, p_code: code.data, p_met: met, p_note: note.data });
  if (error) {
    const r = readable(error);
    return fail(viewer, r.notice, r.detail);
  }
  revalidatePath(PATHS[viewer]);
  return back(viewer, { notice: "golive.done.attested", failed: false });
}

/**
 * Records a person's decision on one proposed value. The owner and the hash come from the registry in code, never from the
 * form: the person is confirming exactly the value that is in force, and the database checks the person is its owner.
 */
export async function signoffConfigAction(formData: FormData): Promise<void> {
  const viewer = await who(formData.get("viewer"));
  if (!viewer) redirect("/");
  const key = z.string().regex(/^[a-z][a-z0-9_.]*$/).safeParse(formData.get("key"));
  const version = z.coerce.number().int().min(1).safeParse(formData.get("version"));
  const decision = z.enum(["confirmed", "changes_requested"]).safeParse(formData.get("decision"));
  const note = noteSchema.safeParse(formData.get("note") ?? undefined);
  if (!key.success || !version.success || !decision.success || !note.success) return fail(viewer, "golive.error.input");
  const entry = findEntry(PROPOSED_CONFIG, key.data, version.data);
  if (!entry || !viewerOwns(entry.owner, viewer)) return fail(viewer, "golive.error.input");
  const { error } = await (await client()).rpc("record_proposed_config_signoff", {
    p_key: entry.key,
    p_version: entry.version,
    p_value_hash: hashConfigValue(entry.value),
    p_owner: entry.owner,
    p_decision: decision.data,
    p_note: note.data || null,
  });
  if (error) {
    const r = readable(error);
    return fail(viewer, r.notice, r.detail);
  }
  revalidatePath(PATHS[viewer]);
  return back(viewer, { notice: "golive.done.signoff", failed: false });
}
