"use server";

import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { rpcVoid } from "@/lib/rota/rpc";
import { runAndRedirect } from "@/lib/rota/run";
import { READINESS_ITEMS } from "./schemas";

/**
 * Acknowledge and close a red event page (S19). Only the clinicians paged, or the Chief Medical Officer, can acknowledge:
 * the database refuses anyone else and its refusal is what the person reads. Ops are told but cannot silence a page.
 */
function text(fd: FormData, key: string): string {
  const v = fd.get(key);
  return typeof v === "string" ? v.trim() : "";
}

export async function acknowledgePage(fd: FormData): Promise<void> {
  await runAndRedirect(fd, "/clinician/on-call", async () => {
    await rpcVoid(await createClient(), "acknowledge_page", { p_page: z.uuid().parse(text(fd, "pageId")) });
    return "Acknowledged. The escalation has stopped. You can now open the patient's chart from here.";
  });
}

export async function closePage(fd: FormData): Promise<void> {
  await runAndRedirect(fd, "/clinician/on-call", async () => {
    await rpcVoid(await createClient(), "close_page", { p_page: z.uuid().parse(text(fd, "pageId")), p_note: text(fd, "note") });
    return "Page closed. Your access to that chart for this event has ended.";
  });
}

/** The clinician states that the phone checklist is done. Every item must be ticked; the database requires the same list. */
export async function confirmReadiness(fd: FormData): Promise<void> {
  await runAndRedirect(fd, "/clinician/on-call", async () => {
    const items = z.array(z.enum(Object.keys(READINESS_ITEMS) as [string, ...string[]])).parse(fd.getAll("item"));
    await rpcVoid(await createClient(), "confirm_on_call_readiness", { p_items: items });
    return "Thank you. You are marked as ready for on-call shifts.";
  });
}
