"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { LEAVE_TYPES } from "./leave";

/**
 * HR Phase C leave actions, used by /account/leave (staff and line managers) and /admin/people/leave. Every rule lives in the
 * database functions (who may ask, who may decide, never yourself, no overlaps, the confirmed cancellation count, the sickness
 * reason only on sick leave). These validate the form and pass a database refusal through as plain words.
 */
export type LeaveActionState = { error?: string; message?: string } | undefined;

interface Rpc {
  rpc(fn: string, args?: Record<string, unknown>): PromiseLike<{ data: unknown; error: { message: string; code?: string } | null }>;
}

/** The leave functions raise plain sentences (P0001, 42501); anything else is replaced so no internal detail reaches the page. */
async function safeLeaveError(error: { message: string; code?: string }): Promise<string> {
  if ((error.code === "P0001" || error.code === "42501") && error.message) return error.message;
  console.error("leave: unexpected database error", error.code ?? "no code", error.message);
  return "Something went wrong. Please try again.";
}

async function call(fn: string, args: Record<string, unknown>, message: string): Promise<LeaveActionState> {
  const supabase = (await createClient()) as unknown as Rpc;
  const { error } = await supabase.rpc(fn, args);
  if (error) return { error: await safeLeaveError(error) };
  revalidatePath("/account/leave");
  revalidatePath("/admin/people", "layout");
  return { message };
}

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Give the dates.");
const optionalText = (max: number) => z.preprocess((v) => (v === null ? undefined : v), z.string().trim().max(max).optional());

const requestSchema = z
  .object({
    leaveType: z.enum(LEAVE_TYPES),
    startsOn: isoDate,
    endsOn: isoDate,
    note: optionalText(500),
    sicknessReason: optionalText(500),
  })
  .superRefine((v, ctx) => {
    if (v.endsOn < v.startsOn) ctx.addIssue({ code: "custom", path: ["endsOn"], message: "The last day cannot be before the first." });
  });

export async function requestLeave(_prev: LeaveActionState, form: FormData): Promise<LeaveActionState> {
  const parsed = requestSchema.safeParse(Object.fromEntries(form));
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Check the form and try again." };
  const v = parsed.data;
  return call("request_leave", {
    p_leave_type: v.leaveType,
    p_starts_on: v.startsOn,
    p_ends_on: v.endsOn,
    p_note: v.note || null,
    // only sick leave carries a reason; anything typed there for another type is dropped, never stored
    p_sickness_reason: v.leaveType === "sick" ? v.sicknessReason || null : null,
  }, "Request sent. You will see the decision here.");
}

export async function cancelLeave(_prev: LeaveActionState, form: FormData): Promise<LeaveActionState> {
  const id = z.string().uuid().safeParse(form.get("requestId"));
  if (!id.success) return { error: "That request was not found." };
  return call("cancel_leave", { p_request: id.data }, "Cancelled.");
}

const decideSchema = z
  .object({
    requestId: z.string().uuid(),
    decision: z.enum(["approved", "rejected"]),
    note: optionalText(500),
    expectedCancellations: z.coerce.number().int().min(0),
  })
  .superRefine((v, ctx) => {
    if (v.decision === "rejected" && (v.note ?? "").length < 5) {
      ctx.addIssue({ code: "custom", path: ["note"], message: "Say briefly why the leave cannot be approved." });
    }
  });

export async function decideLeave(_prev: LeaveActionState, form: FormData): Promise<LeaveActionState> {
  const parsed = decideSchema.safeParse(Object.fromEntries(form));
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Check the form and try again." };
  const v = parsed.data;
  return call("decide_leave", {
    p_request: v.requestId,
    p_decision: v.decision,
    p_note: v.note || null,
    p_expected_cancellations: v.expectedCancellations,
  }, v.decision === "approved" ? "Approved." : "Not approved. The person has been told.");
}
