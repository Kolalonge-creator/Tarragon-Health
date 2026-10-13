import type { SymptomCode } from "@tarragon/clinical";
import { enqueueGroup, flushOutbox, listOutbox, type EnqueueInput } from "./outbox";
import { gradeOnDevice, type DeviceTriage } from "./triage-device";

/**
 * The emergency-symptom question (CMO decision, 2026-10-05; rule BP-X1, text TRI-008).
 *
 * A reading of 200/130 or more is not graded until the patient says whether they have any emergency symptom:
 * "yes" is graded red (BP-R1: emergency guidance and an immediate page), "none" starts the rest and 2 hour recheck
 * (BP-X2). This file holds the two pure pieces the sheet needs: the list it shows and the answer.
 * No language model is ever consulted (INV-01); the grading is the same engine the server runs.
 */

/** The symptoms the question lists: the engine's red-flag group (spec BP-R1, plus trouble speaking and back pain). */
export const QUESTION_SYMPTOMS = [
  "chest_pain",
  "breathlessness",
  "severe_headache",
  "weakness_or_numbness",
  "difficulty_speaking",
  "confusion",
  "visual_disturbance",
  "back_pain",
] as const satisfies readonly SymptomCode[];
export type QuestionSymptom = (typeof QUESTION_SYMPTOMS)[number];

/** Saved on each answered symptom so a clinician can tell it came from this question and was not rated by the patient. */
export const QUESTION_NOTE = "Answered yes to the emergency symptom question after a very high reading (not rated by the patient).";

/** Severity written on an answered symptom. 6 is the existing server paging line (bp.symptom_checklist). */
export const QUESTION_SEVERITY = 6;

export interface QuestionAnswerInput {
  subjectId: string;
  beneficiaryProfileId?: string;
  systolic: number;
  diastolic: number;
  /** The clock the reading was first graded at, so the regrade is of the same reading at the same instant. */
  gradedAtMs: number;
  /** Empty means "none of these". */
  symptoms: readonly QuestionSymptom[];
}

export interface QuestionAnswerResult {
  triage: DeviceTriage;
  /** False when the symptoms could not be saved on the phone: the guidance still shows, the patient is told. */
  saved: boolean;
  syncedAll: boolean;
}

/**
 * Records the answer and grades again. The grade comes first and never waits on the save: a "yes" shows the emergency
 * guidance whether or not the phone could store the symptoms (INV-06). A "none" saves nothing.
 */
export async function answerSymptomQuestion(input: QuestionAnswerInput): Promise<QuestionAnswerResult> {
  const triage = await gradeOnDevice({
    subjectId: input.subjectId,
    systolic: input.systolic,
    diastolic: input.diastolic,
    symptoms: input.symptoms,
    symptomsAnswered: true,
    nowMs: input.gradedAtMs,
  });
  if (input.symptoms.length === 0) return { triage, saved: true, syncedAll: true };

  const rows: EnqueueInput[] = input.symptoms.map((s) => ({
    subjectId: input.subjectId,
    beneficiaryProfileId: input.beneficiaryProfileId,
    kind: "symptom",
    payload: { symptom_type: s, severity: QUESTION_SEVERITY, description: QUESTION_NOTE },
    danger: true,
  }));
  try {
    const items = await enqueueGroup(rows);
    await flushOutbox();
    const ids = new Set(items.map((i) => i.clientId));
    const left = (await listOutbox()).filter((r) => ids.has(r.clientId));
    return { triage, saved: true, syncedAll: left.length === 0 };
  } catch {
    return { triage, saved: false, syncedAll: false };
  }
}
