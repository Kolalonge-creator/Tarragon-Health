import { readFileSync } from "node:fs";
import { join } from "node:path";
import { DOCUMENT_COMMON_PROMPT, DOCUMENT_KIND_INSTRUCTIONS, DOCUMENT_WATERMARK, buildDocumentUserMessage, validateDocument, watermarkedText, type DocumentFact } from "./documents";

const FACTS: DocumentFact[] = [
  { id: "f1", text: "Start amlodipine 5 mg once daily for blood pressure", quote: "we will start amlodipine" },
  { id: "f2", text: "Review blood pressure in 2 weeks", quote: "come back in two weeks" },
];

describe("scribe-documents-mirror", () => {
  it("the web copy is byte-identical to the edge function's copy", () => {
    const edge = join(__dirname, "..", "..", "..", "..", "..", "supabase", "functions", "_shared", "scribe", "documents.ts");
    expect(readFileSync(join(__dirname, "documents.ts"), "utf8")).toBe(readFileSync(edge, "utf8"));
  });
});

describe("validateDocument", () => {
  it("keeps a letter and refuses an empty or non-object result", () => {
    expect(validateDocument("letter", { body: "Dear Dr X" }, FACTS)).toEqual({ kind: "letter", body: "Dear Dr X" });
    expect(validateDocument("letter", { body: "  " }, FACTS)).toBeNull();
    expect(validateDocument("letter", null, FACTS)).toBeNull();
  });

  it("keeps a prescription proposal item only when it cites a confirmed fact that names the medicine", () => {
    const good = { medicine: "Amlodipine", dose: "5 mg", frequency: "once daily", duration: "", reason: "blood pressure", sourceFactId: "f1" };
    const invented = { ...good, medicine: "Metformin" };
    const noFact = { ...good, sourceFactId: "zz" };
    const wrongFact = { ...good, sourceFactId: "f2" };
    const r = validateDocument("prescription_proposal", { items: [good, invented, noFact, wrongFact] }, FACTS);
    expect(r).toMatchObject({ kind: "prescription_proposal", dropped: 3 });
    if (r?.kind === "prescription_proposal") expect(r.items.map((i) => i.medicine)).toEqual(["Amlodipine"]);
  });

  it("keeps a task only with a whole-number due date in range and a real fact id", () => {
    const ok = { description: "Review BP", dueInDays: 14, sourceFactId: "f2" };
    const r = validateDocument("follow_up_tasks", { items: [ok, { ...ok, dueInDays: 0 }, { ...ok, dueInDays: 2.5 }, { ...ok, dueInDays: 999 }, { ...ok, sourceFactId: "nope" }] }, FACTS);
    expect(r).toMatchObject({ kind: "follow_up_tasks", dropped: 4 });
    if (r?.kind === "follow_up_tasks") expect(r.items).toHaveLength(1);
  });

  it("a proposal result with no items array is incomplete", () => {
    expect(validateDocument("follow_up_tasks", { tasks: [] }, FACTS)).toBeNull();
  });
});

describe("watermark and message", () => {
  it("every copied letter starts with the watermark", () => {
    expect(watermarkedText("Hello")).toBe(`[${DOCUMENT_WATERMARK}]\n\nHello`);
    expect(DOCUMENT_WATERMARK).toBe("AI-drafted, unsigned");
  });
  it("the user message carries the fact ids, never a transcript", () => {
    const m = buildDocumentUserMessage("letter", FACTS, { age: 50 });
    expect(m).toContain("[f1] Start amlodipine");
    expect(m).toContain("Age: 50");
  });
});

describe("the unapproved governed prompt", () => {
  const root = join(__dirname, "..", "..", "..", "..", "..", "supabase", "migrations");
  const sql = readFileSync(join(root, "20261027175717_s76_scribe_signed_diffs_problem_reports_document_prompt.sql"), "utf8");
  it("carries the same text as the code constants", () => {
    expect(sql).toContain(DOCUMENT_COMMON_PROMPT);
    for (const text of Object.values(DOCUMENT_KIND_INSTRUCTIONS)) expect(sql).toContain(text);
  });
  it("is inserted inactive, with no approval fields set", () => {
    expect(sql).toMatch(/false\s*\n\s*from public\.ai_systems s/);
    expect(sql).not.toMatch(/approved_at\s*=\s*now|activate_ai_prompt_version\(/);
  });
});
