import type { ProviderResult } from "./result.ts";

/**
 * Speech to text for the AI scribe (spec section 10, decision D-08): the interface and a mock only. No vendor is
 * chosen. Rules every adapter must keep:
 * - A stream cannot start without a recorded scribe consent (INV-11). The adapter checks the id is present and well
 *   formed; the caller proves the consent row exists before it asks.
 * - A transcript is health data. It is returned to the caller and nowhere else: never logged, never put in an error.
 * - Nothing here calls a language model (INV-01) or writes to the patient record (INV-11); a draft is the clinician's to sign.
 */
export type SpeechLanguage = "en-NG";
export type Speaker = "clinician" | "patient" | "unknown";

export interface StartStreamInput {
  /** Opaque encounter reference (a uuid). */
  readonly encounterRef: string;
  readonly language: SpeechLanguage;
  /** Id of the recorded `scribe_consent` row (INV-11). */
  readonly scribeConsentId: string;
  /**
   * Set when restarting after a dropped connection so the new stream continues the same timeline: its first segment
   * starts at `offsetMs` and has index `nextIndex`. Omit for a first stream.
   */
  readonly resumeFrom?: { readonly offsetMs: number; readonly nextIndex: number };
}

export interface TranscriptSegment {
  /** 0-based position, ascending with no gaps. */
  readonly index: number;
  readonly startMs: number;
  readonly endMs: number;
  readonly text: string;
  readonly speaker: Speaker;
  /** 0 to 1 where the engine reports one. */
  readonly confidence: number | null;
}

export interface Transcript {
  readonly segments: readonly TranscriptSegment[];
  readonly durationMs: number;
  readonly language: SpeechLanguage;
}

export interface SpeechStream {
  readonly id: string;
  /** Called for each final segment as it arrives. Returns an unsubscribe function. */
  onSegment(handler: (segment: TranscriptSegment) => void): () => void;
  /** A chunk of audio. Fails with `conflict` after `stop`. */
  push(chunk: Uint8Array): Promise<ProviderResult<null>>;
  /** Ends the stream and returns every segment received. Safe to call twice: the second call returns the same transcript. */
  stop(): Promise<ProviderResult<Transcript>>;
}

export interface SpeechToText {
  readonly name: string;
  readonly isMock: boolean;
  startStream(input: StartStreamInput): Promise<ProviderResult<SpeechStream>>;
}

export const SUPPORTED_LANGUAGES: readonly SpeechLanguage[] = ["en-NG"];
