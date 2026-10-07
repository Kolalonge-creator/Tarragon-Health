import { readFileSync } from "node:fs";
import { join } from "node:path";
import { buildScribeUserMessage, SCRIBE_CLAUDE_MAX_TOKENS, SCRIBE_CLAUDE_MODEL, SCRIBE_NOTE_SCHEMA, SCRIBE_SYSTEM_PROMPT } from "./note-draft";

const FUNCTION = join(__dirname, "..", "..", "..", "..", "..", "supabase", "functions", "scribe-draft", "index.ts");

describe("note-draft.ts mirrors the scribe-draft edge function", () => {
  const source = readFileSync(FUNCTION, "utf8");

  it("has the identical system prompt", () => {
    const m = /const SYSTEM_PROMPT = `([\s\S]*?)`;/.exec(source);
    if (!m?.[1]) throw new Error("SYSTEM_PROMPT not found in the edge function");
    expect(SCRIBE_SYSTEM_PROMPT).toBe(m[1]);
  });

  it("has the identical output schema", () => {
    const m = /const NOTE_SCHEMA = (\{[\s\S]*?\n\});/.exec(source);
    if (!m?.[1]) throw new Error("NOTE_SCHEMA not found in the edge function");
    expect(SCRIBE_NOTE_SCHEMA).toEqual(new Function(`return (${m[1]})`)());
  });

  it("has the identical model and token limit", () => {
    expect(source).toContain(`const SCRIBE_CLAUDE_MODEL = "${SCRIBE_CLAUDE_MODEL}";`);
    expect(source).toContain(`const SCRIBE_CLAUDE_MAX_TOKENS = ${SCRIBE_CLAUDE_MAX_TOKENS};`);
  });

  it("describes typed notes the same way in the function and the evaluation helper", () => {
    const line = "Input type: notes the clinician typed or pasted about the consultation (not a recording).";
    expect(source).toContain(line);
    expect(buildScribeUserMessage("PATIENT: hi", "typed")).toContain(line);
    expect(buildScribeUserMessage("[00:00] PATIENT: hi")).not.toContain("Input type");
  });

  it("drops timestamps for typed notes and records them under their own audit category", () => {
    expect(source).toContain("if (typed) return `${s.speaker.toUpperCase()}: ${s.text}`;");
    expect(source).toContain('typed ? "scribe_typed_notes" : "scribe_transcript"');
  });
});
