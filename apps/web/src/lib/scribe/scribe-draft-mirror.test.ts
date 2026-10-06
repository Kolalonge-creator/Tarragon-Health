import { readFileSync } from "node:fs";
import { join } from "node:path";
import { SCRIBE_CLAUDE_MAX_TOKENS, SCRIBE_CLAUDE_MODEL, SCRIBE_NOTE_SCHEMA, SCRIBE_SYSTEM_PROMPT } from "./note-draft";

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
});
