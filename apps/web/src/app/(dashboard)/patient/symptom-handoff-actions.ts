"use server";

import { createClient } from "@/lib/supabase/server";
import { isSymptomCheckerOpen } from "@/lib/symptom-triage/protocol";

/**
 * Hand-off of a symptom check to the care team (spec 12.5). A summary is created ONLY when the person clicks send, after being shown
 * what it contains; the database builds the contents from the stored check (the client sends no content), and a clinician sees it
 * only once it is attached to a booked consultation. Closed means closed (the database also refuses with 42501).
 */
export type SummaryPreview = {
  complaintKey: string;
  category: string;
  onset: string | null;
  severity: number | null;
  symptoms: string[];
  history: string[];
  questions: { prompt: string; answer: string }[];
};

const readable = (v: unknown): string => (v === true ? "Yes" : v === false ? "No" : String(v ?? ""));

/** What would be sent, read under the person's own session. Pregnancy is left out, exactly as the database leaves it out. */
export async function previewSymptomSummary(assessmentId: string): Promise<SummaryPreview | null> {
  if (!/^[0-9a-f-]{36}$/i.test(assessmentId)) return null;
  const supabase = await createClient();
  const { data } = await supabase
    .from("symptom_triage_assessments")
    .select("presenting_complaint_key, category, initial_capture, questions_asked")
    .eq("id", assessmentId)
    .maybeSingle();
  if (!data) return null;
  const cap = (data.initial_capture ?? {}) as Record<string, unknown>;
  const strs = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : []);
  const qs = Array.isArray(data.questions_asked) ? (data.questions_asked as Record<string, unknown>[]) : [];
  return {
    complaintKey: data.presenting_complaint_key,
    category: data.category,
    onset: typeof cap.onset === "string" ? cap.onset : null,
    severity: typeof cap.severity === "number" ? cap.severity : null,
    symptoms: strs(cap.associatedSymptoms),
    history: strs(cap.relevantHistory).filter((h) => h !== "pregnant"),
    questions: qs.map((q) => ({ prompt: String(q.prompt ?? ""), answer: readable(q.answer) })),
  };
}

export type UpcomingConsultation = { id: string; scheduledFor: string };

/** The person's own booked, upcoming consultations (so a summary can be attached to one). */
export async function listUpcomingConsultations(): Promise<UpcomingConsultation[]> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return [];
  const { data } = await supabase
    .from("appointments")
    .select("id, scheduled_for, status, ends_at")
    .eq("patient_id", user.id)
    .in("status", ["scheduled", "booked", "confirmed", "checked_in"])
    .gte("ends_at", new Date().toISOString())
    .order("scheduled_for", { ascending: true })
    .limit(5);
  return (data ?? []).map((a) => ({ id: a.id, scheduledFor: a.scheduled_for }));
}

export type SendSummaryResult = { status: "sent"; summaryId: string; linked: boolean } | { status: "unavailable" } | { status: "error" };

export async function sendSymptomSummary(assessmentId: string, appointmentId: string | null): Promise<SendSummaryResult> {
  if (!/^[0-9a-f-]{36}$/i.test(assessmentId)) return { status: "error" };
  if (appointmentId !== null && !/^[0-9a-f-]{36}$/i.test(appointmentId)) return { status: "error" };
  if (!(await isSymptomCheckerOpen())) return { status: "unavailable" };
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("send_symptom_summary", {
    p_assessment: assessmentId,
    p_consent_shown: true,
    ...(appointmentId ? { p_appointment: appointmentId } : {}),
  });
  if (error?.code === "42501") return { status: "unavailable" };
  if (error || !data) return { status: "error" };
  const r = data as { summary_id: string; linked: boolean };
  return { status: "sent", summaryId: r.summary_id, linked: r.linked === true };
}

/** Attach an already sent summary to a booking made afterwards. */
export async function attachSummaryToConsultation(summaryId: string, appointmentId: string): Promise<{ ok: boolean }> {
  if (!/^[0-9a-f-]{36}$/i.test(summaryId) || !/^[0-9a-f-]{36}$/i.test(appointmentId)) return { ok: false };
  if (!(await isSymptomCheckerOpen())) return { ok: false };
  const supabase = await createClient();
  const { error } = await supabase.rpc("link_symptom_summary_to_appointment", { p_summary: summaryId, p_appointment: appointmentId });
  return { ok: !error };
}
