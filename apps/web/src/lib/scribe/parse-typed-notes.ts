/**
 * Turns pasted or typed consultation notes into the speaker-tagged segments the scribe-draft function takes.
 * "Doctor: ...", "Dr: ...", "Clinician: ..." and "Patient: ..." prefixes set the speaker; anything else is "unknown",
 * and an unprefixed line continues the previous segment so wrapped text stays together. Nothing here invents content:
 * the text is passed through as written, only split and capped.
 */

export interface TypedSegment {
  index: number;
  startMs: number;
  endMs: number;
  text: string;
  speaker: "clinician" | "patient" | "unknown";
}

export const MAX_TYPED_NOTES_CHARS = 20_000;
export const MIN_TYPED_NOTES_CHARS = 20;
export const MAX_SEGMENT_CHARS = 2000;

// A label ends in a colon, or in a dash with spaces around it: "Patient-reported BP" is a sentence, not a speaker tag.
const PREFIX = /^\s*(doctor|dr\.?|clinician|physician|nurse|patient|pt\.?)\s*(?::|\s[-–]\s)\s*(.*)$/i;

function speakerOf(label: string): TypedSegment["speaker"] {
  const l = label.toLowerCase();
  return l.startsWith("patient") || l.startsWith("pt") ? "patient" : "clinician";
}

function chunk(text: string): string[] {
  if (text.length <= MAX_SEGMENT_CHARS) return [text];
  const parts: string[] = [];
  for (let i = 0; i < text.length; i += MAX_SEGMENT_CHARS) parts.push(text.slice(i, i + MAX_SEGMENT_CHARS));
  return parts;
}

export function parseTypedNotes(raw: string): TypedSegment[] {
  const blocks: { speaker: TypedSegment["speaker"]; text: string }[] = [];
  for (const line of raw.replace(/\r\n?/g, "\n").split("\n")) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    const m = PREFIX.exec(trimmed);
    if (m) {
      blocks.push({ speaker: speakerOf(m[1] ?? ""), text: (m[2] ?? "").trim() });
    } else if (blocks.length > 0) {
      const last = blocks[blocks.length - 1];
      if (last) last.text = `${last.text} ${trimmed}`.trim();
    } else {
      blocks.push({ speaker: "unknown", text: trimmed });
    }
  }
  return blocks
    .filter((b) => b.text.length > 0)
    .flatMap((b) => chunk(b.text).map((text) => ({ speaker: b.speaker, text })))
    .map((b, index) => ({ index, startMs: 0, endMs: 0, ...b }));
}
