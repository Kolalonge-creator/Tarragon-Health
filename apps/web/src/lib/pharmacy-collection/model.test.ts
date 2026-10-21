import { describe, expect, it } from "@jest/globals";
import { alsoSendable, ANSWER_TEXT, answerText, asNotice, chooseFormSchema, dispenseProblem, groupByVisit, MAX_VISIT_ITEMS, noticeForError, parseOverview, QUESTION_REASONS, questionText, viewFor, visitChoice, type Collection } from "./model";

const base: Collection = { state: "signed", pharmacy_name: null, location_name: null, address: null, code: null, code_expires_at: null, locked: null, expired: null, collected: null, can_repeat: null, other_pharmacy_needed: null };

describe("pharmacy collection model", () => {
  it("shows the chooser for a signed prescription, the code once sent, and closed for anything else", () => {
    expect(viewFor(base)).toBe("choose");
    expect(viewFor({ ...base, state: "sent", code: "ABCD2345" })).toBe("code");
    expect(viewFor({ ...base, state: "dispensed" })).toBe("collected");
    expect(viewFor({ ...base, state: "sent", collected: true })).toBe("collected");
    expect(viewFor({ ...base, state: "cancelled" })).toBe("closed");
    // a collected prescription that permits another supply can be sent again, as a new send
    expect(viewFor({ ...base, state: "dispensed", can_repeat: true })).toBe("repeat");
    expect(viewFor({ ...base, state: "dispensed", can_repeat: false })).toBe("collected");
  });
  it("maps database refusals to a notice and anything unknown to a plain failure", () => {
    expect(noticeForError("pharmacy_not_available")).toBe("pharmacy_not_available");
    expect(noticeForError("collection_already_started")).toBe("collection_already_started");
    expect(noticeForError("something odd")).toBe("failed");
    expect(noticeForError(undefined)).toBe("failed");
    expect(asNotice("chosen")).toBe("chosen");
    expect(asNotice("<script>")).toBeNull();
  });
  it("needs three real ids to choose a pharmacy", () => {
    const id = "6f9619ff-8b86-4011-b42d-00c04fc964ff";
    expect(chooseFormSchema.safeParse({ prescription: id, partner: id, location: id }).success).toBe(true);
    expect(chooseFormSchema.safeParse({ prescription: id, partner: "x", location: id }).success).toBe(false);
  });
  it("checks a supply the way the database does", () => {
    const ok = { partial: false, note: "", registration: "PCN12345", pharmacist: "Ada Okafor" };
    expect(dispenseProblem(ok)).toBeNull();
    expect(dispenseProblem({ ...ok, registration: "!!" })).toBe("registration");
    expect(dispenseProblem({ ...ok, pharmacist: "A" })).toBe("pharmacist");
    expect(dispenseProblem({ ...ok, partial: true })).toBe("note");
    expect(dispenseProblem({ ...ok, partial: true, note: "Ten owed" })).toBeNull();
    expect(dispenseProblem({ ...ok, partial: true, note: "x".repeat(301) })).toBe("note");
  });
  it("a supply needs a batch and an expiry (the pharmacy's own record, never called genuine)", () => {
    const ok = { partial: false, note: "", registration: "PCN12345", pharmacist: "Ada Okafor", batch: "B7", expiry: "2027-06-30" };
    expect(dispenseProblem(ok)).toBeNull();
    expect(dispenseProblem({ ...ok, batch: "  " })).toBe("batch");
    expect(dispenseProblem({ ...ok, expiry: "" })).toBe("batch");
  });
  it("the questions and answers are fixed lists with no free text", () => {
    expect(Object.keys(QUESTION_REASONS)).toEqual(["dose_unclear", "strength_unavailable", "substitute_needed", "allergy_or_interaction", "details_do_not_match", "call_me"]);
    expect(Object.keys(ANSWER_TEXT)).toEqual(["keep_as_written", "new_prescription_coming", "patient_to_contact_us"]);
    expect(questionText("anything else")).toBe("A question from the pharmacy");
    expect(answerText(null)).toBe("Answered");
  });
  it("an unreadable prescriber overview is a failed read, never an empty list", () => {
    expect(parseOverview(null)).toBeNull();
    expect(parseOverview({ questions: "none" })).toBeNull();
    expect(parseOverview({ questions: [], collection: [], earlier: [] })).toEqual({ questions: [], collection: [], earlier: [] });
  });
});

describe("visit helpers (S28e)", () => {
  const A = "11111111-1111-4111-8111-111111111111";
  const B = "22222222-2222-4222-8222-222222222222";
  const C = "33333333-3333-4333-8333-333333333333";
  it("visitChoice needs real ids and counts the page's own prescription once", () => {
    expect(visitChoice({ prescription: A, choice: `${B}:${C}`, also: [A, B, B] })).toEqual({ prescription: A, partner: B, location: C, also: [B] });
    expect(visitChoice({ prescription: A, choice: `${B}:${C}:${A}`, also: [] })).toBeNull();
    expect(visitChoice({ prescription: A, choice: "x:y", also: [] })).toBeNull();
    expect(visitChoice({ prescription: "x", choice: `${B}:${C}`, also: [] })).toBeNull();
    expect(visitChoice({ prescription: A, choice: `${B}:${C}`, also: [42] })).toBeNull();
  });
  it("a visit holds at most the configured number of medicines", () => {
    const ids = Array.from({ length: MAX_VISIT_ITEMS }, (_, i) => `44444444-4444-4444-8444-${String(i).padStart(12, "0")}`);
    expect(visitChoice({ prescription: A, choice: `${B}:${C}`, also: ids.slice(0, MAX_VISIT_ITEMS - 1) })).not.toBeNull();
    expect(visitChoice({ prescription: A, choice: `${B}:${C}`, also: ids })).toBe("too_many");
  });
  it("only prescriptions still waiting to be sent can be added to this one", () => {
    const base = { medicine: "X", visit_id: null, pharmacy_name: null, location_name: null, address: null, code: null, code_expires_at: null, locked: false, expired: false, stock_confirmed_at: null, other_pharmacy_needed: false, controlled: false };
    const items = [
      { ...base, prescription_id: A, state: "signed" },
      { ...base, prescription_id: B, state: "signed" },
      { ...base, prescription_id: C, state: "sent" },
    ];
    expect(alsoSendable(items, A).map((i) => i.prescription_id)).toEqual([B]);
  });
  it("groups the pharmacy's waiting prescriptions by the visit they were sent in, and leaves single ones out", () => {
    const g = groupByVisit([
      { prescription_id: A, visit_id: B, stock_confirmed_at: null },
      { prescription_id: C, visit_id: B, stock_confirmed_at: "2026-10-16T10:00:00Z" },
      { prescription_id: B, visit_id: null, stock_confirmed_at: null },
    ]);
    expect([...g.entries()]).toEqual([[B, [A, C]]]);
  });
  it("a visit refusal is a notice the patient can read", () => {
    expect(noticeForError("visit_size_invalid")).toBe("visit_size_invalid");
    expect(asNotice("chosen_many")).toBe("chosen_many");
  });
});
