import { screenWrittenQuestion } from "@tarragon/clinical/written-question-screen";
import { mapWrittenQuestionError, type MappedError } from "./errors";
import { QUESTION_MAX_LENGTH, QUESTION_MIN_LENGTH, type WrittenQuestionCategory } from "./types";

/** The only calls the send flow needs; the real implementation wraps the Supabase client (see the query file). */
export interface WrittenQuestionGateway {
  submitQuestion(args: {
    category: WrittenQuestionCategory;
    question: string;
    durationNote: string | null;
    clientId: string;
  }): Promise<{ id: string | null; error: string | null }>;
  /** The path is built from the photo's own stable id, so a retry writes the same path. "Already there" counts as done. */
  uploadPhoto(consultId: string, photo: PhotoToSend): Promise<{ path: string | null; error: string | null }>;
  attachPhoto(args: { consultId: string; path: string; mime: string; bytes: number }): Promise<{ error: string | null }>;
}

export interface PhotoToSend {
  /** Stable for the life of the picked photo, so a retry reuses the same storage path. */
  id: string;
  blob: Blob;
}

export interface SubmitInput {
  /** One id per unsent question (see draft.ts). A retry sends the same id. */
  clientId: string;
  category: WrittenQuestionCategory;
  question: string;
  durationNote: string;
  photos: PhotoToSend[];
  /** The patient chose "I understand" after the red-flag panel. */
  redFlagAcknowledged: boolean;
}

export type SubmitOutcome =
  | { kind: "red_flag" }
  | { kind: "invalid"; error: MappedError }
  | { kind: "error"; error: MappedError }
  | { kind: "sent"; consultId: string; photoFailures: number };

/**
 * Validate, run the deterministic red-flag screen (INV-01, INV-06), then send. A red flag holds the send until the
 * patient acknowledges it; nothing reaches the network before that.
 */
export async function sendWrittenQuestion(gateway: WrittenQuestionGateway, input: SubmitInput): Promise<SubmitOutcome> {
  const question = input.question.trim();
  const duration = input.durationNote.trim();
  if (question.length < QUESTION_MIN_LENGTH || question.length > QUESTION_MAX_LENGTH) {
    return { kind: "invalid", error: { key: "wq.error.length", params: { min: QUESTION_MIN_LENGTH } } };
  }
  if (!input.redFlagAcknowledged && screenWrittenQuestion(`${question} ${duration}`).redFlag) {
    return { kind: "red_flag" };
  }

  const created = await gateway.submitQuestion({ category: input.category, question, durationNote: duration || null, clientId: input.clientId });
  if (created.error !== null || created.id === null) {
    return { kind: "error", error: mapWrittenQuestionError(created.error) };
  }

  let photoFailures = 0;
  for (const photo of input.photos) {
    const { blob } = photo;
    const up = await gateway.uploadPhoto(created.id, photo);
    if (up.error !== null || up.path === null) {
      photoFailures += 1;
      continue;
    }
    const attached = await gateway.attachPhoto({ consultId: created.id, path: up.path, mime: "image/jpeg", bytes: blob.size });
    if (attached.error !== null) photoFailures += 1;
  }
  return { kind: "sent", consultId: created.id, photoFailures };
}
