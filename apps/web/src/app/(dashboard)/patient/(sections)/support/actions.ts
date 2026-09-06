"use server";

import { createClient } from "@/lib/supabase/server";
import { resolveSubjectId } from "@/lib/acting/acting-for";
import { createSupportTicketSchema } from "@/lib/validation/support-tickets";
import { fileComplaintSchema } from "@/lib/validation/complaints";
import { detectDangerSigns } from "@/lib/support/detect-danger-signs";
import { dangerSignsSummary } from "@/lib/validation/emergency";

export type CreateSupportTicketState =
  | { error: string }
  | { success: true; ticketId: string }
  | { emergencyDetected: true; eventId: string }
  | undefined;

/**
 * Files a technical support ticket (§24.4, narrowed to technical-only — see
 * the support_tickets_category_technical_only migration) — unless the free
 * text reads like a real medical emergency, in which case this never
 * creates a ticket at all: it inserts an emergency_events row instead
 * (source='support_ticket_intake'), the same acknowledge-gated pathway the
 * one-touch danger-symptom check uses (§24.7 — "Support workflow should
 * immediately direct toward the appropriate emergency pathway, rather than
 * creating an ordinary support ticket"). The DB trigger on emergency_events
 * raises the emergency-tier clinician_alert — this action never decides
 * urgency itself.
 */
export async function createSupportTicket(
  _prevState: CreateSupportTicketState,
  formData: FormData
): Promise<CreateSupportTicketState> {
  const parsed = createSupportTicketSchema.safeParse({
    subject: formData.get("subject"),
    description: formData.get("description"),
  });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Check the form and try again" };
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return { error: "Not signed in" };
  }

  const subjectId = await resolveSubjectId(user.id);

  const { data: profile } = await supabase
    .from("profiles")
    .select("organisation_id")
    .eq("id", subjectId)
    .single();
  if (!profile?.organisation_id) {
    return { error: "No organisation on file" };
  }

  const dangerSigns = detectDangerSigns(`${parsed.data.subject} ${parsed.data.description}`);
  if (dangerSigns.length > 0) {
    const { data, error } = await supabase
      .from("emergency_events")
      .insert({
        patient_id: subjectId,
        organisation_id: profile.organisation_id,
        source: "support_ticket_intake",
        trigger_detail: dangerSignsSummary(dangerSigns),
        status: "active",
      })
      .select("id")
      .single();
    if (error) {
      return { error: error.message };
    }
    return { emergencyDetected: true, eventId: data.id };
  }

  const { data, error } = await supabase
    .from("support_tickets")
    .insert({
      patient_id: subjectId,
      organisation_id: profile.organisation_id,
      category: "technical",
      subject: parsed.data.subject,
      description: parsed.data.description,
    })
    .select("id")
    .single();
  if (error) {
    return { error: error.message };
  }

  return { success: true, ticketId: data.id };
}

export type FileComplaintState = { error?: string; success?: boolean; complaintId?: string } | undefined;

/** Files a complaint (§24.14) — staff-owned once submitted; see complaints' own RLS/trigger. */
export async function fileComplaint(_prevState: FileComplaintState, formData: FormData): Promise<FileComplaintState> {
  const relatedTicketId = formData.get("related_ticket_id");
  const parsed = fileComplaintSchema.safeParse({
    category: formData.get("category"),
    description: formData.get("description"),
    related_ticket_id: relatedTicketId ? relatedTicketId : undefined,
  });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Check the form and try again" };
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return { error: "Not signed in" };
  }

  const subjectId = await resolveSubjectId(user.id);

  const { data: profile } = await supabase
    .from("profiles")
    .select("organisation_id")
    .eq("id", subjectId)
    .single();
  if (!profile?.organisation_id) {
    return { error: "No organisation on file" };
  }

  const { data, error } = await supabase
    .from("complaints")
    .insert({
      patient_id: subjectId,
      organisation_id: profile.organisation_id,
      category: parsed.data.category,
      description: parsed.data.description,
      related_ticket_id: parsed.data.related_ticket_id ?? null,
    })
    .select("id")
    .single();
  if (error) {
    return { error: error.message };
  }

  return { success: true, complaintId: data.id };
}
