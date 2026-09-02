import { NextResponse } from "next/server";
import { z } from "zod";
import { createClient, getCurrentUser } from "@/lib/supabase/server";

/**
 * Health Communication Engine — two-way notification response (17.9).
 * Captures a quick-reply tap (e.g. an appointment reminder's Yes/Reschedule/
 * Cancel/Need help buttons) and, where a real action exists for the
 * template + chosen value, calls the same RPC the app's own UI would call
 * (advance_appointment_status/cancel_appointment) — never by parsing an
 * inbound WhatsApp/SMS reply into an action (see CLAUDE.md's standing rule
 * against that). Always stamps responded_at/response_value on the
 * notification row so 17.13's delivery/response tracking is complete even
 * for a template with no wired action yet.
 *
 * RLS-scoped throughout: every read/update is additionally filtered to
 * recipient_id = auth.uid(), and every RPC called here is itself
 * SECURITY DEFINER and re-derives the caller's own authorisation — this
 * route adds no privilege the caller didn't already have via the app UI.
 */

const paramsSchema = z.object({ id: z.string().uuid() });
const bodySchema = z.object({ value: z.string().min(1).max(64) });

interface ResponseOption {
  label: string;
  value: string;
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ ok: false, error: "unauthenticated" }, { status: 401 });
  }

  const parsedParams = paramsSchema.safeParse(await params);
  if (!parsedParams.success) {
    return NextResponse.json({ ok: false }, { status: 400 });
  }

  let json: unknown;
  try {
    json = await request.json();
  } catch {
    return NextResponse.json({ ok: false }, { status: 400 });
  }
  const parsedBody = bodySchema.safeParse(json);
  if (!parsedBody.success) {
    return NextResponse.json({ ok: false }, { status: 400 });
  }
  const { value } = parsedBody.data;

  const supabase = await createClient();
  const { data: notification, error: fetchError } = await supabase
    .from("notifications")
    .select("id, template, payload, response_options, responded_at, response_value")
    .eq("id", parsedParams.data.id)
    .eq("recipient_id", user.id)
    .maybeSingle();

  if (fetchError || !notification) {
    return NextResponse.json({ ok: false, error: "notification not found" }, { status: 404 });
  }

  // Already responded — return the prior response idempotently rather than
  // erroring on a double-tap (e.g. a slow network retry from the client).
  if (notification.responded_at) {
    return NextResponse.json({ ok: true, alreadyResponded: true, value: notification.response_value });
  }

  const options = (notification.response_options ?? []) as unknown as ResponseOption[];
  if (!options.some((o) => o.value === value)) {
    return NextResponse.json({ ok: false, error: "not a valid response for this notification" }, { status: 400 });
  }

  const payload = (notification.payload ?? {}) as Record<string, unknown>;
  let actionCompleted = false;
  let redirect: string | null = null;

  if (notification.template === "appointment_reminder" && typeof payload.appointment_id === "string") {
    const appointmentId = payload.appointment_id;
    if (value === "confirm") {
      const { error } = await supabase.rpc("advance_appointment_status", {
        p_appointment_id: appointmentId,
        p_to: "confirmed",
      });
      actionCompleted = !error;
    } else if (value === "cancel") {
      const { error } = await supabase.rpc("cancel_appointment", {
        p_appointment_id: appointmentId,
        p_reason: "Cancelled by patient in response to a reminder",
      });
      actionCompleted = !error;
    } else if (value === "reschedule") {
      redirect = `/patient/care?reschedule=${appointmentId}`;
    } else if (value === "need_help") {
      redirect = "/patient/messages";
    }
  }

  const nowIso = new Date().toISOString();
  const { error: updateError } = await supabase
    .from("notifications")
    .update({
      responded_at: nowIso,
      response_value: value,
      ...(actionCompleted ? { action_completed_at: nowIso } : {}),
    })
    .eq("id", parsedParams.data.id)
    .eq("recipient_id", user.id);

  if (updateError) {
    return NextResponse.json({ ok: false, error: updateError.message }, { status: 200 });
  }

  return NextResponse.json({ ok: true, actionCompleted, redirect });
}
