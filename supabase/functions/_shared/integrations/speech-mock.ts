import { fail, ok, type ProviderResult } from "./result.ts";
import { isUuid } from "./ids.ts";
import { SUPPORTED_LANGUAGES, type Speaker, type SpeechStream, type SpeechToText, type Transcript, type TranscriptSegment } from "./speech.ts";

export interface ScriptedSegment {
  readonly text: string;
  readonly speaker: Speaker;
  readonly durationMs: number;
}
export interface MockSpeechOptions {
  /** One scripted segment is revealed for each audio chunk pushed. */
  readonly script: readonly ScriptedSegment[];
  /** The Nth chunk (1-based) fails the way a dropped connection does. */
  readonly failOnChunk?: number;
}

export function createMockSpeech(options: MockSpeechOptions): SpeechToText {
  let seq = 0;
  return {
    name: "mock",
    isMock: true,
    async startStream(input): Promise<ProviderResult<SpeechStream>> {
      if (!isUuid(input.scribeConsentId)) return fail("consent_required", "A recorded scribe consent is required before transcription", false);
      if (!isUuid(input.encounterRef)) return fail("invalid_input", "Encounter reference must be an opaque uuid");
      if (!SUPPORTED_LANGUAGES.includes(input.language)) return fail("unsupported", "Language is not supported", false);
      const resume = input.resumeFrom;
      if (resume && !(Number.isInteger(resume.offsetMs) && resume.offsetMs >= 0 && Number.isInteger(resume.nextIndex) && resume.nextIndex >= 0)) {
        return fail("invalid_input", "Resume point is not valid");
      }

      seq += 1;
      const handlers = new Set<(s: TranscriptSegment) => void>();
      const segments: TranscriptSegment[] = [];
      let cursorMs = resume?.offsetMs ?? 0;
      const firstIndex = resume?.nextIndex ?? 0;
      let chunks = 0;
      let stopped: Transcript | null = null;

      const stream: SpeechStream = {
        id: `stt_mock_${seq}`,
        onSegment(handler) {
          handlers.add(handler);
          return () => {
            handlers.delete(handler);
          };
        },
        async push(chunk) {
          if (stopped) return fail("conflict", "Stream has ended", false);
          if (chunk.byteLength === 0) return fail("invalid_input", "Audio chunk is empty");
          chunks += 1;
          if (options.failOnChunk === chunks) return fail("network", "Could not reach the vendor");
          const next = options.script[segments.length];
          if (next) {
            const segment: TranscriptSegment = {
              index: firstIndex + segments.length,
              startMs: cursorMs,
              endMs: cursorMs + next.durationMs,
              text: next.text,
              speaker: next.speaker,
              confidence: 0.9,
            };
            cursorMs = segment.endMs;
            segments.push(segment);
            for (const h of handlers) h(segment);
          }
          return ok(null);
        },
        async stop() {
          stopped ??= { segments: [...segments], durationMs: cursorMs, language: input.language };
          return ok(stopped);
        },
      };
      return ok(stream);
    },
  };
}
