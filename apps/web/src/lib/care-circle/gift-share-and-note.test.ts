/**
 * The model behind sharing with a gift payer and the doctor's line for the family (2026-11-03): what the screen may send (Zod, before
 * the database checks it again), what it reads back, and the null-gated note shape.
 */
import {
  CIRCLE_PERMISSIONS, GIFT_SHARE_PERMISSIONS, GIFT_SHARE_USUAL, familyNoteShareInputSchema, giftShareInputSchema, parseGiftPayers, parseMyFamilyNotes,
  parseSupporterView, payerForEntitlement,
} from "./model";

const PAYER_ID = "8b0e1f4e-7d55-4a9b-9a51-1f5f0d6b2c11";

describe("gift share input", () => {
  it("accepts a non-empty list of offered permissions", () => {
    expect(giftShareInputSchema.safeParse({ payerId: PAYER_ID, permissions: [...GIFT_SHARE_USUAL], monthlyReport: true }).success).toBe(true);
  });
  it("refuses an empty list, an unknown name, attend_consultation, a repeat and a non-uuid payer", () => {
    expect(giftShareInputSchema.safeParse({ payerId: PAYER_ID, permissions: [], monthlyReport: false }).success).toBe(false);
    expect(giftShareInputSchema.safeParse({ payerId: PAYER_ID, permissions: ["everything"], monthlyReport: false }).success).toBe(false);
    expect(giftShareInputSchema.safeParse({ payerId: PAYER_ID, permissions: ["attend_consultation"], monthlyReport: false }).success).toBe(false);
    expect(giftShareInputSchema.safeParse({ payerId: PAYER_ID, permissions: ["red_alerts", "red_alerts"], monthlyReport: false }).success).toBe(false);
    expect(giftShareInputSchema.safeParse({ payerId: "not-a-uuid", permissions: ["red_alerts"], monthlyReport: false }).success).toBe(false);
  });
  it("the usual set is the four the brief names, and every offered permission is a real circle permission", () => {
    expect([...GIFT_SHARE_USUAL].sort()).toEqual(["adherence_summary", "appointments", "red_alerts", "weekly_bp_trend"]);
    for (const p of GIFT_SHARE_PERMISSIONS) expect(CIRCLE_PERMISSIONS).toContain(p);
    expect(GIFT_SHARE_PERMISSIONS).not.toContain("attend_consultation");
  });
});

describe("gift payers", () => {
  const row = { payer_id: PAYER_ID, first_name: "Chinedu", entitlement_ids: ["e1", "e2"], last_gift_at: "2026-11-03T10:00:00Z", is_member: false };
  it("parses rows and drops a malformed one", () => {
    expect(parseGiftPayers([row, { payer_id: 1 }])).toEqual([row]);
    expect(parseGiftPayers(null)).toEqual([]);
  });
  it("finds the payer of the gift just accepted, or none", () => {
    expect(payerForEntitlement([row], "e2")?.payer_id).toBe(PAYER_ID);
    expect(payerForEntitlement([row], "e9")).toBeNull();
  });
});

describe("the patient's own notes (patient first)", () => {
  const row = { note_id: "6a1f0c1e-2b3d-4e5f-8a9b-0c1d2e3f4a5b", body: "Well done.", written_at: "2026-11-03T10:00:00Z", author_staff_id: null, author_name: null, shared: false, decided: false };
  it("parses rows and drops a malformed one", () => {
    expect(parseMyFamilyNotes([row, { ...row, shared: "yes" }])).toEqual([row]);
    expect(parseMyFamilyNotes(undefined)).toEqual([]);
  });
  it("the share input needs a real note id and a yes or no", () => {
    expect(familyNoteShareInputSchema.safeParse({ noteId: row.note_id, share: true }).success).toBe(true);
    expect(familyNoteShareInputSchema.safeParse({ noteId: "x", share: true }).success).toBe(false);
    expect(familyNoteShareInputSchema.safeParse({ noteId: row.note_id }).success).toBe(false);
  });
});

describe("supporter view with the doctor's line", () => {
  const base = { patient_id: "p", name: "Mama", relationship: "Mother", permissions: ["doctor_note"], shared_until: "2027-01-01T00:00:00Z" };
  it("absent means not shared, null means none yet, and a note keeps its null-gated author", () => {
    expect(parseSupporterView(base)?.doctor_note).toBeUndefined();
    expect(parseSupporterView({ ...base, doctor_note: null })?.doctor_note).toBeNull();
    const v = parseSupporterView({ ...base, doctor_note: { body: "Well done today.", written_at: "2026-11-03T10:00:00Z", author_staff_id: null, author_name: null } });
    expect(v?.doctor_note?.author_name).toBeNull();
  });
  it("a note longer than 280 characters does not parse (the screen shows nothing rather than something half-wrong)", () => {
    expect(parseSupporterView({ ...base, doctor_note: { body: "a".repeat(281), written_at: "x", author_staff_id: null, author_name: null } })).toBeNull();
  });
});
