"use server";

import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { createServiceRoleClient } from "@/lib/supabase/service-role";
import {
  isTwilioProxyConfigured,
  createProxySession,
  addProxyParticipant,
  closeProxySession,
} from "@/lib/twilio/proxy-client";

const requestSchema = z.object({
  patientId: z.string().uuid(),
  staffProfileId: z.string().uuid(),
  context: z.enum(["care_coordination", "clinical_follow_up", "escalation_contact"]),
  escalationId: z.string().uuid().optional(),
});

export type RequestMaskedCallState =
  | { error: string }
  | { success: true; configured: false }
  | { success: true; configured: true; sessionId: string; dialNumber: string }
  | undefined;

/**
 * Requests a masked/proxy call between a patient and their assigned
 * clinician or care coordinator — see 20260730153034_masked_calling_twilio_proxy.sql.
 * The DB row is created first (via request_masked_call, RLS-scoped to the
 * caller's own session), then — only if Twilio Proxy is configured — this
 * action reads both participants' real phone numbers through a
 * service-role client (ownership already proven by the RPC succeeding) and
 * hands them to Twilio, storing back only the masked number Twilio
 * returns. Same DB-row-first / vendor-call-second / graceful-degrade
 * shape as startVirtualReview's Zoom integration.
 */
export async function requestMaskedCall(
  input: z.infer<typeof requestSchema>
): Promise<RequestMaskedCallState> {
  const parsed = requestSchema.safeParse(input);
  if (!parsed.success) {
    return { error: "Invalid request" };
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return { error: "Not signed in" };
  }

  const { data: sessionId, error: rpcError } = await supabase.rpc("request_masked_call", {
    p_patient_id: parsed.data.patientId,
    p_staff_profile_id: parsed.data.staffProfileId,
    p_context: parsed.data.context,
    p_escalation_id: parsed.data.escalationId ?? null,
  });
  if (rpcError || !sessionId) {
    return { error: rpcError?.message ?? "Could not request the call" };
  }

  if (!isTwilioProxyConfigured()) {
    return { success: true, configured: false };
  }

  const service = createServiceRoleClient();

  const { data: participants } = await service
    .from("masked_call_participants")
    .select("id, profile_id, role")
    .eq("session_id", sessionId);

  const patientParticipant = participants?.find((p) => p.role === "patient");
  const staffParticipant = participants?.find((p) => p.role === "staff");
  if (!patientParticipant || !staffParticipant) {
    await service
      .from("masked_call_sessions")
      .update({ status: "failed", vendor_error: "Participants not found" })
      .eq("id", sessionId);
    return { error: "Could not set up the call" };
  }

  const { data: profiles } = await service
    .from("profiles")
    .select("id, phone")
    .in("id", [patientParticipant.profile_id, staffParticipant.profile_id]);

  const patientPhone = profiles?.find((p) => p.id === patientParticipant.profile_id)?.phone;
  const staffPhone = profiles?.find((p) => p.id === staffParticipant.profile_id)?.phone;

  if (!patientPhone || !staffPhone) {
    await service
      .from("masked_call_sessions")
      .update({ status: "failed", vendor_error: "A participant has no phone number on file" })
      .eq("id", sessionId);
    return { error: "One of the participants has no phone number on file" };
  }

  const sessionResult = await createProxySession(sessionId);
  if (!sessionResult.ok) {
    await service
      .from("masked_call_sessions")
      .update({ status: "failed", vendor_error: sessionResult.error })
      .eq("id", sessionId);
    return { error: "Could not start the call — try again shortly" };
  }

  const patientAdd = await addProxyParticipant(sessionResult.data.sessionSid, patientPhone, "Patient");
  const staffAdd = patientAdd.ok
    ? await addProxyParticipant(sessionResult.data.sessionSid, staffPhone, "Care team")
    : null;

  if (!patientAdd.ok || !staffAdd?.ok) {
    const error = !patientAdd.ok ? patientAdd.error : (staffAdd && !staffAdd.ok ? staffAdd.error : "Unknown error");
    await service
      .from("masked_call_sessions")
      .update({
        status: "failed",
        vendor_error: error,
        twilio_proxy_service_sid: sessionResult.data.proxyServiceSid,
        twilio_proxy_session_sid: sessionResult.data.sessionSid,
      })
      .eq("id", sessionId);
    return { error: "Could not connect both parties — try again shortly" };
  }

  await service
    .from("masked_call_sessions")
    .update({
      status: "active",
      twilio_proxy_service_sid: sessionResult.data.proxyServiceSid,
      twilio_proxy_session_sid: sessionResult.data.sessionSid,
    })
    .eq("id", sessionId);

  await service
    .from("masked_call_participants")
    .update({
      twilio_participant_sid: patientAdd.data.participantSid,
      twilio_proxy_identifier: patientAdd.data.proxyIdentifier,
    })
    .eq("id", patientParticipant.id);

  await service
    .from("masked_call_participants")
    .update({
      twilio_participant_sid: staffAdd.data.participantSid,
      twilio_proxy_identifier: staffAdd.data.proxyIdentifier,
    })
    .eq("id", staffParticipant.id);

  const callerIsPatient = user.id === patientParticipant.profile_id;
  const dialNumber = callerIsPatient ? patientAdd.data.proxyIdentifier : staffAdd.data.proxyIdentifier;
  if (!dialNumber) {
    return { error: "Call connected, but your dial-in number is still being assigned — refresh in a moment" };
  }

  return { success: true, configured: true, sessionId, dialNumber };
}

const sessionIdSchema = z.string().uuid();

/** Ends a masked call early. Either party or org staff may call this — enforced inside close_masked_call itself. */
export async function endMaskedCall(sessionId: string): Promise<{ error: string } | undefined> {
  const parsed = sessionIdSchema.safeParse(sessionId);
  if (!parsed.success) {
    return { error: "Invalid session" };
  }

  const supabase = await createClient();
  const { error } = await supabase.rpc("close_masked_call", {
    p_session_id: parsed.data,
    p_reason: null,
  });
  if (error) {
    return { error: error.message };
  }

  if (isTwilioProxyConfigured()) {
    const service = createServiceRoleClient();
    const { data: session } = await service
      .from("masked_call_sessions")
      .select("twilio_proxy_session_sid")
      .eq("id", parsed.data)
      .maybeSingle();
    if (session?.twilio_proxy_session_sid) {
      await closeProxySession(session.twilio_proxy_session_sid);
    }
  }

  return undefined;
}
