"use server";

import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { rpcVoid } from "@/lib/rota/rpc";
import { runAndRedirect } from "@/lib/rota/run";
import { calleeKindSchema, callOutcomeSchema, parseWindowLines } from "./schemas";

/**
 * The ops desk forms (OQ-441). Every rule lives in the database: who may do what, that a number must be confirmed and real before a
 * contact can be made active, and that a call is only ever added to the log, never changed. This file only sends the forms.
 */
function text(fd: FormData, key: string): string {
  const v = fd.get(key);
  return typeof v === "string" ? v.trim() : "";
}

const PAGE = "/admin/ops/desk" as const;

export async function saveContact(fd: FormData): Promise<void> {
  await runAndRedirect(fd, PAGE, async () => {
    await rpcVoid(await createClient(), "ops_desk_save_contact", { p_profile: z.uuid().parse(text(fd, "profile")), p_role: z.enum(["primary", "deputy"]).parse(text(fd, "role")) });
    return "The contact was saved as inactive. Set their hours, then activate them.";
  });
}

export async function setWindows(fd: FormData): Promise<void> {
  await runAndRedirect(fd, PAGE, async () => {
    const windows = parseWindowLines(text(fd, "windows"));
    await rpcVoid(await createClient(), "ops_desk_set_windows", { p_contact: z.uuid().parse(text(fd, "contact")), p_windows: windows });
    return `Saved ${windows.length} window${windows.length === 1 ? "" : "s"} of hours (Lagos time).`;
  });
}

export async function setContactActive(fd: FormData): Promise<void> {
  await runAndRedirect(fd, PAGE, async () => {
    const active = text(fd, "active") === "yes";
    await rpcVoid(await createClient(), "ops_desk_set_contact_active", { p_contact: z.uuid().parse(text(fd, "contact")), p_active: active, p_note: text(fd, "note") || null });
    return active ? "The contact is active. They will be told to phone when a page expires during their hours." : "The contact is no longer active.";
  });
}

export async function acknowledgeIncident(fd: FormData): Promise<void> {
  await runAndRedirect(fd, PAGE, async () => {
    await rpcVoid(await createClient(), "ops_desk_acknowledge", { p_incident: z.uuid().parse(text(fd, "incident")) });
    return "You have taken this one. Start with the call sheet.";
  });
}

export async function logCall(fd: FormData): Promise<void> {
  await runAndRedirect(fd, PAGE, async () => {
    const [kind, callee] = text(fd, "callee").split("|");
    await rpcVoid(await createClient(), "log_ops_desk_call", {
      p_incident: z.uuid().parse(text(fd, "incident")),
      p_callee_kind: calleeKindSchema.parse(kind),
      p_callee_profile: z.uuid().parse(callee),
      p_outcome: callOutcomeSchema.parse(text(fd, "outcome")),
      p_note: text(fd, "note") || null,
    });
    return "The call was recorded. It cannot be edited, so add a new line if something changes.";
  });
}

export async function attestItem(fd: FormData): Promise<void> {
  // the form posts its own page as returnTo (both ops desk pages are on the allowed list), so the CMO comes back to /clinician/ops-desk
  await runAndRedirect(fd, PAGE, async () => {
    await rpcVoid(await createClient(), "attest_ops_desk_item", {
      p_item: z.string().min(1).max(60).parse(text(fd, "item")),
      p_state: z.enum(["in_place", "not_in_place"]).parse(text(fd, "state")),
      p_evidence: text(fd, "evidence"),
    });
    return "Your statement was recorded under your name and today's date.";
  });
}
