"use server";

import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { rpcParsed, rpcVoid } from "./rpc";
import { runAndRedirect } from "./run";
import { lagosLocalToIso } from "./time";

/**
 * Server actions for availability, the rota, swaps, conflicts and leads (S18). The screens decide who sees which
 * button; the database decides who may actually do it, and its refusal is what the person reads. The outcome travels
 * back through ?ok= or ?error= so a failure is never silent.
 */
function text(fd: FormData, key: string): string {
  const v = fd.get(key);
  return typeof v === "string" ? v.trim() : "";
}
const uuid = z.uuid();
const isoOrThrow = (fd: FormData, key: string): string => {
  const v = lagosLocalToIso(text(fd, key));
  if (!v) throw Object.assign(new Error("Check the date and time."), { code: "22023" });
  return v;
};

async function call(fn: string, args: Record<string, unknown>): Promise<void> {
  await rpcVoid(await createClient(), fn, args);
}

// ---- A clinician's own hours, swaps and replies ----------------------------------------------------------------
export async function declareHours(fd: FormData): Promise<void> {
  await runAndRedirect(fd, "/clinician/rota", async () => {
    const kind = z.enum(["queue", "on_call", "bookable_consultations"]).parse(text(fd, "kind"));
    await call("declare_availability", { p_kind: kind, p_starts: isoOrThrow(fd, "starts"), p_ends: isoOrThrow(fd, "ends") });
    return kind === "on_call" ? "On-call hours sent for approval." : "Hours declared.";
  });
}

export async function cancelHours(fd: FormData): Promise<void> {
  await runAndRedirect(fd, "/clinician/rota", async () => {
    await call("cancel_availability", { p_block: uuid.parse(text(fd, "blockId")) });
    return "Hours cancelled.";
  });
}

export async function requestSwap(fd: FormData): Promise<void> {
  await runAndRedirect(fd, "/clinician/rota", async () => {
    await call("request_rota_swap", {
      p_rota: uuid.parse(text(fd, "rotaId")),
      p_role: z.enum(["primary", "backup"]).parse(text(fd, "role")),
      p_to: uuid.parse(text(fd, "to")),
      p_reason: text(fd, "reason"),
    });
    return "Cover request sent.";
  });
}

export async function respondSwap(fd: FormData): Promise<void> {
  await runAndRedirect(fd, "/clinician/rota", async () => {
    const accept = text(fd, "answer") === "accept";
    await call("respond_rota_swap", { p_swap: uuid.parse(text(fd, "swapId")), p_accept: accept });
    return accept ? "You accepted. A reviewer approves it before it counts." : "You declined.";
  });
}

export async function cancelSwap(fd: FormData): Promise<void> {
  await runAndRedirect(fd, "/clinician/rota", async () => {
    await call("cancel_rota_swap", { p_swap: uuid.parse(text(fd, "swapId")) });
    return "Request withdrawn.";
  });
}

export async function declareConflict(fd: FormData): Promise<void> {
  await runAndRedirect(fd, "/clinician/rota", async () => {
    await call("declare_conflict", { p_patient: uuid.parse(text(fd, "patientId")), p_reason: text(fd, "reason") });
    return "Conflict recorded. The Chief Medical Officer has been told.";
  });
}

// ---- Reviewers: admin or the Chief Medical Officer ---------------------------------------------------------------
const REVIEW_FALLBACK = "/admin/rota" as const;

export async function setShift(fd: FormData): Promise<void> {
  await runAndRedirect(fd, REVIEW_FALLBACK, async () => {
    const out = await rpcParsed(
      await createClient(),
      "set_on_call_rota",
      {
        p_starts_at: isoOrThrow(fd, "starts"),
        p_ends_at: isoOrThrow(fd, "ends"),
        p_primary: uuid.parse(text(fd, "primary")),
        p_backup: uuid.parse(text(fd, "backup")),
        p_override_reason: text(fd, "override") || null,
      },
      z.object({ id: z.uuid(), warnings: z.array(z.string()) }),
    );
    return out.warnings.length > 0 ? `Shift saved with an override: ${out.warnings.join("; ")}` : "Shift saved.";
  });
}

export async function cancelShift(fd: FormData): Promise<void> {
  await runAndRedirect(fd, REVIEW_FALLBACK, async () => {
    await call("cancel_on_call_rota", { p_rota: uuid.parse(text(fd, "rotaId")), p_reason: text(fd, "reason") });
    return "Shift cancelled.";
  });
}

export async function confirmHours(fd: FormData): Promise<void> {
  await runAndRedirect(fd, REVIEW_FALLBACK, async () => {
    await call("confirm_availability_block", { p_block: uuid.parse(text(fd, "blockId")) });
    return "On-call hours confirmed.";
  });
}

export async function approveSwap(fd: FormData): Promise<void> {
  await runAndRedirect(fd, REVIEW_FALLBACK, async () => {
    await call("approve_rota_swap", { p_swap: uuid.parse(text(fd, "swapId")), p_override_reason: text(fd, "override") || null });
    return "Swap approved.";
  });
}

export async function assignLead(fd: FormData): Promise<void> {
  await runAndRedirect(fd, REVIEW_FALLBACK, async () => {
    const lead = await rpcParsed(await createClient(), "assign_lead_clinician", { p_patient: uuid.parse(text(fd, "patientId")) }, z.uuid().nullable());
    return lead ? "Lead clinician assigned." : "Nobody is free to lead yet. The patient is still waiting and the team has been alerted.";
  });
}

export async function changeLead(fd: FormData): Promise<void> {
  await runAndRedirect(fd, REVIEW_FALLBACK, async () => {
    const reason = z.enum(["clinician_request", "patient_request", "capacity_rebalance", "conflict"]).parse(text(fd, "reason"));
    await call("change_lead_clinician", { p_patient: uuid.parse(text(fd, "patientId")), p_reason: reason, p_note: text(fd, "note") });
    return "Lead changed. The patient and the new lead have been told.";
  });
}
