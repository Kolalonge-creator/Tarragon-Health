"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { describeLowCarbReasons, loadLowCarbProgramme, configFrom } from "@/lib/lowcarb/programme";
import { REVIEW_STOP_WORDS, REVIEW_TRIGGER_WORDS, runLowCarbMedicineReview } from "@/lib/lowcarb/medicine-review";

/**
 * S50b: server actions for the low-carbohydrate programme panel on the clinician chart. Each validates its input with Zod and runs the matching
 * database function under the signed-in clinician's own session (no service role). The database is the gate: a tied prescriber only, the guard, the
 * signed rules, the screen. Nothing here changes a medicine: the review action only ever creates unsigned DRAFT proposals, and a patient is never
 * messaged about a medicine from here (INV-02, INV-07).
 */

export type LowCarbActionState = { error?: string; message?: string; lines?: string[] } | undefined;

const NOT_ALLOWED = "You are not allowed to do this for this patient. Only a prescriber tied to this patient can run the programme.";
const GENERIC = "Something went wrong and nothing was changed. Try again, and tell the care team lead if it keeps happening.";

const patientSchema = z.object({ patientId: z.string().uuid() });
const enrolmentSchema = patientSchema.extend({ enrolmentId: z.string().uuid() });
const offerSchema = patientSchema.extend({
  noRecentAdmission: z.literal(true, { message: "Confirm there has been no recent severe low sugar or hospital admission." }),
  supervisionAccepted: z.boolean(),
  supervisionNote: z.string().trim().max(1000).optional(),
});
const reviewNoteSchema = enrolmentSchema.extend({ note: z.string().trim().min(10, "Say what you decided about the medicines.").max(2000) });

function readableError(error: { code?: string; message?: string } | null | undefined): string {
  if (!error) return GENERIC;
  if (error.code === "42501") return NOT_ALLOWED;
  if (error.code === "23505") return "This person already has an open programme.";
  if ((error.code === "22023" || error.code === "55000") && typeof error.message === "string" && error.message.trim()) return error.message.trim();
  return GENERIC;
}

const checked = (f: FormData, k: string): boolean => f.get(k) === "on";
const text = (f: FormData, k: string): string => String(f.get(k) ?? "");

function done(patientId: string, message: string): LowCarbActionState {
  revalidatePath(`/clinician/patients/${patientId}`);
  return { message };
}

export async function checkLowCarbEligibility(_prev: LowCarbActionState, formData: FormData): Promise<LowCarbActionState> {
  const parsed = patientSchema.safeParse({ patientId: text(formData, "patientId") });
  if (!parsed.success) return { error: "Check the form." };
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("lowcarb_eligibility", {
    p_patient: parsed.data.patientId,
    p_no_recent_admission: checked(formData, "noRecentAdmission"),
    p_supervision_accepted: checked(formData, "supervisionAccepted"),
  });
  if (error) return { error: readableError(error) };
  const result = z.object({ decision: z.string(), reasons: z.array(z.string()) }).safeParse(data);
  if (!result.success) return { error: GENERIC };
  // The database has already collapsed a not-eligible answer to one vague reason for a clinician without reproductive-health access.
  const lines = describeLowCarbReasons(result.data.reasons);
  if (result.data.decision === "eligible") return { message: "This person meets the programme screen today.", lines: [] };
  if (result.data.decision === "needs_supervision") return { message: "A doctor must accept supervision of the medicines first.", lines };
  if (result.data.decision === "not_now") return { message: "Not today.", lines };
  return { message: "This person does not meet the programme screen.", lines };
}

export async function offerLowCarb(_prev: LowCarbActionState, formData: FormData): Promise<LowCarbActionState> {
  const parsed = offerSchema.safeParse({
    patientId: text(formData, "patientId"),
    noRecentAdmission: checked(formData, "noRecentAdmission") ? true : undefined,
    supervisionAccepted: checked(formData, "supervisionAccepted"),
    supervisionNote: text(formData, "supervisionNote"),
  });
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Check the form." };
  const supabase = await createClient();
  const { error } = await supabase.rpc("offer_lowcarb_programme", {
    p_patient: parsed.data.patientId,
    p_no_recent_admission: true,
    p_supervision_accepted: parsed.data.supervisionAccepted,
    ...(parsed.data.supervisionNote ? { p_supervision_note: parsed.data.supervisionNote } : {}),
  });
  if (error) {
    // The detail lists reasons; a pregnancy reason is shown only if the clinician is entitled to it (the database already coarsened it).
    const reasons = typeof (error as { details?: unknown }).details === "string" ? String((error as { details?: string }).details).split(",") : [];
    const lines = describeLowCarbReasons(reasons);
    return { error: readableError(error), lines };
  }
  return done(parsed.data.patientId, "Offered. The patient decides whether to start.");
}

async function transition(formData: FormData, fn: "pause_lowcarb_programme" | "resume_lowcarb_programme" | "stop_lowcarb_programme", okText: string): Promise<LowCarbActionState> {
  const parsed = enrolmentSchema.safeParse({ patientId: text(formData, "patientId"), enrolmentId: text(formData, "enrolmentId") });
  if (!parsed.success) return { error: "Check the form." };
  const supabase = await createClient();
  const { error } = await supabase.rpc(fn, { p_enrolment: parsed.data.enrolmentId });
  if (error) return { error: readableError(error) };
  return done(parsed.data.patientId, okText);
}

export async function pauseLowCarb(_prev: LowCarbActionState, formData: FormData): Promise<LowCarbActionState> {
  return transition(formData, "pause_lowcarb_programme", "Paused.");
}
export async function resumeLowCarb(_prev: LowCarbActionState, formData: FormData): Promise<LowCarbActionState> {
  return transition(formData, "resume_lowcarb_programme", "Resumed.");
}
export async function stopLowCarb(_prev: LowCarbActionState, formData: FormData): Promise<LowCarbActionState> {
  return transition(formData, "stop_lowcarb_programme", "Stopped.");
}

const supervisionSchema = enrolmentSchema.extend({ note: z.string().trim().min(10, "Say how you will supervise these medicines.").max(2000) });

/** A medicine the doctor never accepted supervision of has appeared: the prescriber accepts supervision of the current ones, with a note. */
export async function acceptLowCarbSupervision(_prev: LowCarbActionState, formData: FormData): Promise<LowCarbActionState> {
  const parsed = supervisionSchema.safeParse({ patientId: text(formData, "patientId"), enrolmentId: text(formData, "enrolmentId"), note: text(formData, "note") });
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Check the form." };
  const supabase = await createClient();
  const { error } = await supabase.rpc("accept_lowcarb_supervision", { p_enrolment: parsed.data.enrolmentId, p_note: parsed.data.note });
  if (error) return { error: readableError(error) };
  return done(parsed.data.patientId, "Supervision of the current medicines is recorded. You can resume the programme.");
}

export async function completeLowCarbReview(_prev: LowCarbActionState, formData: FormData): Promise<LowCarbActionState> {
  const parsed = reviewNoteSchema.safeParse({ patientId: text(formData, "patientId"), enrolmentId: text(formData, "enrolmentId"), note: text(formData, "note") });
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Check the form." };
  const supabase = await createClient();
  const { error } = await supabase.rpc("complete_lowcarb_medicine_review", { p_enrolment: parsed.data.enrolmentId, p_note: parsed.data.note });
  if (error) return { error: readableError(error) };
  return done(parsed.data.patientId, "Medicine review recorded.");
}

/** Runs the pure medicine check. `createDrafts` stores unsigned drafts in the Care plan changes panel; it never signs and never applies anything. */
export async function runLowCarbReview(_prev: LowCarbActionState, formData: FormData): Promise<LowCarbActionState> {
  const parsed = patientSchema.safeParse({ patientId: text(formData, "patientId") });
  if (!parsed.success) return { error: "Check the form." };
  const createDrafts = checked(formData, "createDrafts");
  const supabase = await createClient();
  const loaded = await loadLowCarbProgramme(supabase, parsed.data.patientId);
  if (loaded.status === "denied") return { error: NOT_ALLOWED };
  if (loaded.status === "error") return { error: loaded.message };
  const config = configFrom(loaded.programme);
  const enrolment = loaded.programme.enrolment;
  if (config === null || enrolment === null) return { error: "There is no running programme to check." };
  const run = await runLowCarbMedicineReview(supabase, {
    patientId: parsed.data.patientId,
    config,
    programmeActive: enrolment.status === "active" || enrolment.status === "paused",
    lastMedicineReviewAt: enrolment.last_medicine_review_at,
    createDrafts,
  });
  if (run.kind === "error") return { error: run.message };
  if (run.kind === "no_protocol") {
    return { message: "The diabetes step table has not been written yet, so the platform makes no medicine suggestion. Review the medicines by hand.", lines: [] };
  }
  const r = run.result;
  if (r.kind === "no_proposal") return { message: "No medicine suggestion today.", lines: r.reasons.map((c) => REVIEW_STOP_WORDS[c] ?? c) };
  const lines = [
    ...r.triggers.map((t) => REVIEW_TRIGGER_WORDS[t] ?? t),
    ...r.proposals.map((p) =>
      p.action === "stop"
        ? `Suggestion for you to decide: ${p.drugName} (${p.currentDose}) could be stopped. ${p.proposable ? "" : "It was not issued by a clinician here, so no draft is made."}`
        : `Suggestion for you to decide: review the dose of ${p.drugName} (${p.currentDose}). You set any new dose.`,
    ),
    ...run.created.map((c) => `Draft created for ${c.drugName}. It is unsigned: find it under Care plan changes.`),
    ...run.notes,
  ];
  if (run.created.length > 0) revalidatePath(`/clinician/patients/${parsed.data.patientId}`);
  return { message: `Sugar readings used: ${r.readingCount}${r.averageGlucose === null ? "" : `, average ${r.averageGlucose}`}. Nothing has been changed for the patient.`, lines };
}
