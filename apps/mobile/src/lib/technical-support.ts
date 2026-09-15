import { supabase } from "./supabase";
import type { QueryResult } from "./medications";
import type { Tables, Enums } from "@tarragon/shared";

export type SupportTicket = Tables<"support_tickets">;
export type SupportTicketStatus = Enums<"support_ticket_status">;

export const TICKET_STATUS_LABEL: Record<SupportTicketStatus, string> = {
  new: "New",
  assigned: "Assigned",
  in_progress: "In progress",
  awaiting_patient: "Awaiting you",
  resolved: "Resolved",
  closed: "Closed",
};

// ---------------------------------------------------------------------------
// Emergency-detection safety net — a support ticket whose free text reads
// like a real medical emergency must never become an ordinary ticket
// (§24.7). Ported verbatim from apps/web/src/lib/support/detect-danger-signs.ts
// (a plain, dependency-free keyword scan — nothing server-only about it) so
// the native ticket form carries the exact same safety check, not a
// simplified one. Keep the two lists in sync if the vocabulary changes.
// ---------------------------------------------------------------------------

const DANGER_SIGN_KEYWORDS: Record<string, string[]> = {
  chest_pain: ["chest pain", "chest pressure", "tight chest", "chest hurts"],
  trouble_breathing: [
    "can't breathe",
    "cant breathe",
    "trouble breathing",
    "difficulty breathing",
    "short of breath",
    "shortness of breath",
  ],
  face_arm_weakness_or_slurred_speech: [
    "slurred speech",
    "face drooping",
    "one side of my face",
    "arm weakness",
    "can't move my arm",
    "cant move my arm",
  ],
  severe_bleeding: ["severe bleeding", "won't stop bleeding", "wont stop bleeding", "bleeding a lot"],
  fainting_or_unresponsive: ["fainted", "passed out", "unresponsive", "lost consciousness"],
  seizure: ["seizure", "convulsion", "convulsing"],
  severe_allergic_reaction: [
    "throat is closing",
    "throat tightening",
    "can't swallow",
    "cant swallow",
    "severe allergic reaction",
    "anaphylaxis",
  ],
  thoughts_of_self_harm: ["harm myself", "hurt myself", "kill myself", "end my life", "suicidal"],
  sudden_severe_headache: ["worst headache", "sudden severe headache", "sudden, severe headache"],
  severe_abdominal_pain: ["severe stomach pain", "severe abdominal pain", "unbearable stomach pain"],
};

const DANGER_SIGN_LABEL: Record<string, string> = {
  chest_pain: "Chest pain or pressure",
  trouble_breathing: "Trouble breathing",
  face_arm_weakness_or_slurred_speech: "Face/arm weakness or slurred speech",
  severe_bleeding: "Severe bleeding",
  fainting_or_unresponsive: "Fainting or unresponsiveness",
  seizure: "Seizure",
  severe_allergic_reaction: "Severe allergic reaction",
  thoughts_of_self_harm: "Thoughts of self-harm",
  sudden_severe_headache: "Sudden, severe headache",
  severe_abdominal_pain: "Severe abdominal pain",
};

function detectDangerSigns(text: string): string[] {
  const normalised = text.toLowerCase();
  return Object.keys(DANGER_SIGN_KEYWORDS).filter((sign) =>
    DANGER_SIGN_KEYWORDS[sign].some((phrase) => normalised.includes(phrase))
  );
}

function dangerSignsSummary(signs: string[]): string {
  return signs.map((sign) => DANGER_SIGN_LABEL[sign]).join(", ");
}

export type CreateTicketResult =
  | { kind: "error"; error: string }
  | { kind: "success"; ticketId: string }
  | { kind: "emergency"; eventId: string };

/**
 * Mirrors createSupportTicket in apps/web/.../support/actions.ts: scans the
 * free text for the same danger-sign vocabulary first, and — if it matches —
 * never creates a ticket at all, inserting an emergency_events row instead
 * (source='support_ticket_intake'). The DB trigger on emergency_events
 * raises the emergency-tier clinician_alert; this function never decides
 * urgency itself, only whether to route there.
 */
export async function createSupportTicket(input: {
  patientId: string;
  organisationId: string;
  subject: string;
  description: string;
}): Promise<CreateTicketResult> {
  const subject = input.subject.trim();
  const description = input.description.trim();
  if (subject.length < 3) return { kind: "error", error: "Give it a short subject" };
  if (description.length < 10) {
    return { kind: "error", error: "A sentence or two helps your care team get this right the first time" };
  }

  const dangerSigns = detectDangerSigns(`${subject} ${description}`);
  if (dangerSigns.length > 0) {
    const { data, error } = await supabase
      .from("emergency_events")
      .insert({
        patient_id: input.patientId,
        organisation_id: input.organisationId,
        source: "support_ticket_intake",
        trigger_detail: dangerSignsSummary(dangerSigns),
        status: "active",
      })
      .select("id")
      .single();
    if (error) return { kind: "error", error: error.message };
    return { kind: "emergency", eventId: data.id };
  }

  const { data, error } = await supabase
    .from("support_tickets")
    .insert({
      patient_id: input.patientId,
      organisation_id: input.organisationId,
      category: "technical",
      subject,
      description,
    })
    .select("id")
    .single();
  if (error) return { kind: "error", error: error.message };
  return { kind: "success", ticketId: data.id };
}

export async function loadMySupportTickets(patientId: string): Promise<QueryResult<SupportTicket[]>> {
  const { data, error } = await supabase
    .from("support_tickets")
    .select("*")
    .eq("patient_id", patientId)
    .order("created_at", { ascending: false });
  if (error) return { ok: false, error: error.message };
  return { ok: true, data: data as SupportTicket[] };
}
