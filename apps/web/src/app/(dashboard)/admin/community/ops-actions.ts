"use server";

import { revalidatePath } from "next/cache";
import { outcomeSchema, staffRefusalText } from "@/lib/community/model";
import { friendlyDbError } from "./errors";
import { cancelQaSchema, createQaSchema, groupImagesSchema, setShiftsSchema } from "./ops-schemas";
import { getRpcClient } from "./rpc";
import type { ActionState } from "./state";

/**
 * Server actions for pictures, the moderator rota and doctor question sessions. The database checks who may do each one (auth.uid()
 * inside the function), so nothing here trusts a role from the browser. Every reply is parsed and turned into plain English; raw
 * database text is never returned.
 */
const BASE = "/admin/community";
const GENERIC = "That could not be done. Please try again.";

const text = (f: FormData, k: string): string => {
  const v = f.get(k);
  return typeof v === "string" ? v : "";
};
const firstIssue = (e: { issues: Array<{ message: string }> }): string => e.issues[0]?.message || "Please check the form and try again.";

async function call(fn: string, args: Record<string, unknown>, okText: string, paths: string[]): Promise<NonNullable<ActionState>> {
  const client = await getRpcClient();
  const { data, error } = await client.rpc(fn, args);
  if (error) return { ok: false, message: friendlyDbError(error) };
  const parsed = outcomeSchema.safeParse(data);
  if (!parsed.success) return { ok: false, message: GENERIC };
  if (parsed.data.status === "refused") return { ok: false, message: staffRefusalText(parsed.data.reason) };
  if (parsed.data.status !== "ok") return { ok: false, message: GENERIC };
  for (const p of paths) revalidatePath(p);
  return { ok: true, message: okText };
}

export async function setGroupImagesAction(_prev: ActionState, f: FormData): Promise<ActionState> {
  const p = groupImagesSchema.safeParse({ id: text(f, "id"), on: text(f, "on") });
  if (!p.success) return { ok: false, message: GENERIC };
  return call(
    "community_admin_set_group_images",
    { p_id: p.data.id, p_on: p.data.on },
    p.data.on
      ? "Pictures are now allowed in this group. Every picture waits for a moderator before anyone sees it."
      : "Pictures are now switched off in this group.",
    [`${BASE}/groups`],
  );
}

export async function setShiftsAction(_prev: ActionState, f: FormData): Promise<ActionState> {
  const p = setShiftsSchema.safeParse({ staff_id: text(f, "staff_id"), shifts: text(f, "shifts") });
  if (!p.success) return { ok: false, message: firstIssue(p.error) };
  return call(
    "community_admin_set_shifts",
    { p_staff_id: p.data.staff_id, p_shifts: p.data.shifts },
    p.data.shifts.length === 0 ? "All shifts for this person were cleared." : "The shifts were saved.",
    [`${BASE}/rota`, BASE],
  );
}

/** Doctor ids can be ticked from the list and/or pasted (separated by spaces, commas or new lines). Duplicates are dropped. */
function doctorIds(f: FormData): string[] {
  const ticked = f.getAll("doctor_ids").filter((v): v is string => typeof v === "string");
  const pasted = text(f, "doctor_ids_pasted").split(/[\s,]+/).map((s) => s.trim()).filter(Boolean);
  return [...new Set([...ticked, ...pasted])];
}

export async function createQaAction(_prev: ActionState, f: FormData): Promise<ActionState> {
  const p = createQaSchema.safeParse({
    title: text(f, "title"),
    intro: text(f, "intro"),
    opens_at: text(f, "opens_at"),
    closes_at: text(f, "closes_at"),
    doctor_ids: doctorIds(f),
    group_ids: f.getAll("group_ids").filter((v): v is string => typeof v === "string"),
  });
  if (!p.success) return { ok: false, message: firstIssue(p.error) };
  return call(
    "community_admin_create_qa",
    {
      p_title: p.data.title,
      p_intro: p.data.intro,
      p_opens_at: p.data.opens_at,
      p_closes_at: p.data.closes_at,
      p_doctor_ids: p.data.doctor_ids,
      p_group_ids: p.data.group_ids,
    },
    "The session was created.",
    [`${BASE}/sessions`],
  );
}

export async function cancelQaAction(_prev: ActionState, f: FormData): Promise<ActionState> {
  const p = cancelQaSchema.safeParse({ series_id: text(f, "series_id") });
  if (!p.success) return { ok: false, message: GENERIC };
  return call("community_admin_cancel_qa", { p_series_id: p.data.series_id }, "The session was cancelled.", [`${BASE}/sessions`]);
}
