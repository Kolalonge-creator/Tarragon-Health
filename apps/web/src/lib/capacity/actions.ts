"use server";

import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { RotaError, rpcParsed, rpcVoid } from "@/lib/rota/rpc";
import { describeActivationReason } from "@/lib/queries/pending-queue-paging-config-signoff";
import { runAndRedirect } from "@/lib/rota/run";
import { lagosLocalToIso } from "@/lib/rota/time";

/**
 * Surge mode, pause, intake override, rest-rule override and cover-offer answers (S16-S20 Stage 5). Every rule lives in the
 * database: it checks who you are (only the Chief Medical Officer starts a surge or a pause or overrides; an administrator can
 * only ask for a pause), the length and the written reason, and its refusal is what the person reads.
 */
function text(fd: FormData, key: string): string {
  const v = fd.get(key);
  return typeof v === "string" ? v.trim() : "";
}

const hours = z.coerce.number().int().min(1).max(72);

export async function startOpsMode(fd: FormData): Promise<void> {
  await runAndRedirect(fd, "/clinician/capacity", async () => {
    const mode = z.enum(["surge", "pause"]).parse(text(fd, "mode"));
    await rpcVoid(await createClient(), "cmo_start_ops_mode", { p_mode: mode, p_reason: text(fd, "reason"), p_hours: hours.parse(text(fd, "hours")) });
    return mode === "surge" ? "Surge mode is on. It switches itself off at the time you chose." : "The pause is on. It switches itself off at the time you chose. Urgent pages and work already taken carry on.";
  });
}

export async function requestPause(fd: FormData): Promise<void> {
  await runAndRedirect(fd, "/admin/capacity", async () => {
    await rpcVoid(await createClient(), "request_ops_pause", { p_reason: text(fd, "reason") });
    return "Your request was sent to the clinical lead. Nothing is paused unless they confirm in time.";
  });
}

export async function decidePause(fd: FormData): Promise<void> {
  await runAndRedirect(fd, "/clinician/capacity", async () => {
    const confirm = text(fd, "decision") === "confirm";
    await rpcVoid(await createClient(), "cmo_decide_ops_pause", {
      p_id: z.uuid().parse(text(fd, "id")),
      p_confirm: confirm,
      p_hours: confirm ? hours.parse(text(fd, "hours")) : null,
      p_note: text(fd, "note") || null,
    });
    return confirm ? "The pause is on." : "The request was declined. Nothing was paused.";
  });
}

export async function endOpsMode(fd: FormData): Promise<void> {
  await runAndRedirect(fd, "/clinician/capacity", async () => {
    await rpcVoid(await createClient(), "cmo_end_ops_mode", { p_id: z.uuid().parse(text(fd, "id")), p_note: text(fd, "note") || null });
    return "That mode is now off.";
  });
}

export async function setIntakeOverride(fd: FormData): Promise<void> {
  await runAndRedirect(fd, "/clinician/capacity", async () => {
    await rpcVoid(await createClient(), "cmo_set_intake_override", { p_reason: text(fd, "reason"), p_hours: hours.parse(text(fd, "hours")) });
    return "The override is recorded. New sales follow the other limits again until it ends.";
  });
}

export async function endIntakeOverride(fd: FormData): Promise<void> {
  await runAndRedirect(fd, "/clinician/capacity", async () => {
    await rpcVoid(await createClient(), "cmo_end_intake_override", { p_id: z.uuid().parse(text(fd, "id")) });
    return "The override has ended.";
  });
}

export async function overrideRestRule(fd: FormData): Promise<void> {
  await runAndRedirect(fd, "/clinician/capacity", async () => {
    const from = lagosLocalToIso(text(fd, "from"));
    const to = lagosLocalToIso(text(fd, "to"));
    if (!from || !to) throw new z.ZodError([]);
    await rpcVoid(await createClient(), "cmo_override_rest_rule", {
      p_clinician: z.uuid().parse(text(fd, "clinician")),
      p_from: from,
      p_to: to,
      p_reason: text(fd, "reason"),
    });
    return "The rest rule override is recorded for that window.";
  });
}

export async function respondCoverOffer(fd: FormData): Promise<void> {
  await runAndRedirect(fd, "/clinician/rest-and-cover", async () => {
    const fit = text(fd, "answer") === "fit";
    await rpcVoid(await createClient(), "respond_cover_offer", { p_offer: z.uuid().parse(text(fd, "id")), p_fit: fit, p_note: text(fd, "note") || null });
    return fit ? "Thank you. Your answer is recorded." : "Thank you. The clinical lead has been asked to arrange cover for that shift.";
  });
}

const testPageDays = z.coerce.number().int().min(1).max(365);
const testPageDaysAnswer = z.object({
  changed: z.boolean(),
  version: z.number().int().optional(),
  days: z.number().int().optional(),
  reasons: z.array(z.object({ clinician_id: z.string().optional(), name: z.string().nullish(), gaps: z.array(z.string()).optional() })).default([]),
});

/** The Chief Medical Officer chooses how many days an acknowledged test page keeps an on-call clinician ready. The database does the signing. */
export async function setPagingTestPageDays(fd: FormData): Promise<void> {
  await runAndRedirect(fd, "/clinician/capacity", async () => {
    const days = testPageDays.parse(text(fd, "days"));
    const answer = await rpcParsed(await createClient(), "set_paging_test_page_days", { p_days: days, p_reason: text(fd, "reason") }, testPageDaysAnswer);
    if (!answer.changed) {
      const who = answer.reasons.slice(0, 3).map((r) => describeActivationReason({ code: "clinician_not_ready", ...r }));
      throw new RotaError(`Not changed. With ${days} days these on-call clinicians would not be ready: ${who.join("; ")}${answer.reasons.length > 3 ? ` and ${answer.reasons.length - 3} more` : ""}.`, "22023");
    }
    return `A test page now keeps a clinician ready for ${days} days. It is signed in your name as paging configuration version ${answer.version}.`;
  });
}
