import { PROBLEM_CATEGORIES, isSafetyCategory, problemReportSchema } from "./problem-report";
import { clearQueuedDraftRequest, isOfflineError, queueDraftRequest, readQueuedDraftRequest } from "./offline-queue";
import { PLAIN_TEMPLATE_HEADINGS, isTemplateEmpty, plainNoteTemplate } from "./plain-template";

function memoryStorage(): Pick<Storage, "getItem" | "setItem" | "removeItem"> & { data: Map<string, string> } {
  const data = new Map<string, string>();
  return { data, getItem: (k) => data.get(k) ?? null, setItem: (k, v) => void data.set(k, v), removeItem: (k) => void data.delete(k) };
}
const NOTE = "11111111-1111-4111-8111-111111111111";
const CONSENT = "22222222-2222-4222-8222-222222222222";

describe("problem report taxonomy", () => {
  it("has exactly the five fixed categories", () => {
    expect([...PROBLEM_CATEGORIES]).toEqual(["invented_content", "omission", "wrong_medicine_or_dose", "wrong_patient", "other"]);
  });
  it("refuses a category outside the taxonomy and an over-long comment", () => {
    const base = { noteId: NOTE, consentId: CONSENT, draftKind: "note", section: "plan", category: "invented_content" };
    expect(problemReportSchema.safeParse(base).success).toBe(true);
    expect(problemReportSchema.safeParse({ ...base, category: "rude" }).success).toBe(false);
    expect(problemReportSchema.safeParse({ ...base, comment: "x".repeat(501) }).success).toBe(false);
    expect(problemReportSchema.safeParse({ ...base, section: null, consentId: null }).success).toBe(true);
  });
  it("wrong patient and wrong medicine are the safety categories", () => {
    expect(isSafetyCategory("wrong_patient")).toBe(true);
    expect(isSafetyCategory("wrong_medicine_or_dose")).toBe(true);
    expect(isSafetyCategory("omission")).toBe(false);
  });
});

describe("offline queue", () => {
  it("queues, reads back, and clears", () => {
    const s = memoryStorage();
    expect(queueDraftRequest({ noteId: NOTE, consentId: CONSENT, text: "headache" }, 1000, s)).toBe(true);
    expect(readQueuedDraftRequest(NOTE, 2000, s)).toMatchObject({ text: "headache", queuedAt: 1000 });
    clearQueuedDraftRequest(NOTE, s);
    expect(readQueuedDraftRequest(NOTE, 2000, s)).toBeNull();
  });
  it("drops a request older than the time limit", () => {
    const s = memoryStorage();
    queueDraftRequest({ noteId: NOTE, consentId: CONSENT, text: "x" }, 0, s);
    expect(readQueuedDraftRequest(NOTE, 31 * 60_000, s)).toBeNull();
    expect(s.data.size).toBe(0);
  });
  it("replaces rather than stacks, and survives broken storage", () => {
    const s = memoryStorage();
    queueDraftRequest({ noteId: NOTE, consentId: CONSENT, text: "one" }, 1, s);
    queueDraftRequest({ noteId: NOTE, consentId: CONSENT, text: "two" }, 2, s);
    expect(s.data.size).toBe(1);
    const broken = { getItem: () => { throw new Error("blocked"); }, setItem: () => { throw new Error("blocked"); }, removeItem: () => { throw new Error("blocked"); } };
    expect(queueDraftRequest({ noteId: NOTE, consentId: CONSENT, text: "x" }, 1, broken)).toBe(false);
    expect(readQueuedDraftRequest(NOTE, 1, broken)).toBeNull();
    expect(() => clearQueuedDraftRequest(NOTE, broken)).not.toThrow();
    expect(queueDraftRequest({ noteId: NOTE, consentId: CONSENT, text: "x" }, 1, null)).toBe(false);
  });
  it("discards a malformed entry", () => {
    const s = memoryStorage();
    s.setItem(`tarragon.scribe.pending.${NOTE}`, "{\"noteId\": 5}");
    expect(readQueuedDraftRequest(NOTE, 1, s)).toBeNull();
    expect(s.data.size).toBe(0);
  });
  it("tells offline from a server refusal", () => {
    expect(isOfflineError(new Error("anything"), false)).toBe(true);
    expect(isOfflineError(new TypeError("Failed to fetch"), true)).toBe(true);
    expect(isOfflineError(new Error("consent_not_active"), true)).toBe(false);
  });
});

describe("plain template", () => {
  it("has a heading per line and is empty until something is typed", () => {
    const t = plainNoteTemplate();
    for (const h of PLAIN_TEMPLATE_HEADINGS) expect(t).toContain(`${h}:`);
    expect(isTemplateEmpty(t)).toBe(true);
    expect(isTemplateEmpty(t.replace("History:\n", "History:\nCough for 3 days"))).toBe(false);
  });
});
