/**
 * Mobile: sharing with the person who paid, and the doctor's line for the family (2026-11-03). What may be sent (checked before the
 * call), what is read back, the null-gated author, and that a re-read never drops a step already on screen.
 */
import {
  GIFT_SHARE_PERMISSIONS, GIFT_SHARE_USUAL, CIRCLE_PERMISSIONS, familyNoteAuthor, mergeKeepingShown, parseGiftPayers, parseMyFamilyNotes, parseSupporterView, validGiftShare,
} from "./parse";

const mockRpc = jest.fn();
jest.mock("../supabase", () => ({ supabase: { rpc: (...a: unknown[]) => mockRpc(...a) } }));
import { dismissGiftPayer, loadGiftPayers, loadMyFamilyNotes, setFamilyNoteShared, shareWithGiftPayer } from "./api";

const PAYER = "8b0e1f4e-7d55-4a9b-9a51-1f5f0d6b2c11";
beforeEach(() => mockRpc.mockReset());

describe("gift share", () => {
  it("the usual set is the four named, every offered permission is real, attend_consultation is never offered", () => {
    expect([...GIFT_SHARE_USUAL].sort()).toEqual(["adherence_summary", "appointments", "red_alerts", "weekly_bp_trend"]);
    for (const p of GIFT_SHARE_PERMISSIONS) expect(CIRCLE_PERMISSIONS).toContain(p);
    expect(GIFT_SHARE_PERMISSIONS as readonly string[]).not.toContain("attend_consultation");
  });
  it("validGiftShare refuses empty, unknown, repeated and non-uuid", () => {
    expect(validGiftShare(PAYER, ["red_alerts"])).toBe(true);
    expect(validGiftShare(PAYER, [])).toBe(false);
    expect(validGiftShare(PAYER, ["attend_consultation"])).toBe(false);
    expect(validGiftShare(PAYER, ["red_alerts", "red_alerts"])).toBe(false);
    expect(validGiftShare("x", ["red_alerts"])).toBe(false);
  });
  it("never calls the database for an invalid choice", async () => {
    await expect(shareWithGiftPayer(PAYER, [], false)).resolves.toEqual({ ok: false, reason: "invalid" });
    expect(mockRpc).not.toHaveBeenCalled();
  });
  it("sends exactly what was ticked and maps a full circle and a failure", async () => {
    mockRpc.mockResolvedValueOnce({ data: { ok: true, member_id: "m" }, error: null });
    await expect(shareWithGiftPayer(PAYER, ["doctor_note"], true)).resolves.toEqual({ ok: true });
    expect(mockRpc).toHaveBeenCalledWith("share_circle_with_gift_payer", { p_payer: PAYER, p_permissions: ["doctor_note"], p_monthly_report: true });
    mockRpc.mockResolvedValueOnce({ data: null, error: { message: "circle_full" } });
    await expect(shareWithGiftPayer(PAYER, ["red_alerts"], false)).resolves.toEqual({ ok: false, reason: "full" });
    mockRpc.mockResolvedValueOnce({ data: null, error: { message: "circle_payer_not_found" } });
    await expect(shareWithGiftPayer(PAYER, ["red_alerts"], false)).resolves.toEqual({ ok: false, reason: "failed" });
  });
  it("reads payers, drops a malformed row, and a failed read is none", async () => {
    mockRpc.mockResolvedValueOnce({ data: [{ payer_id: PAYER, first_name: "Chinedu", entitlement_ids: ["e1"] }, { payer_id: "bad" }], error: null });
    await expect(loadGiftPayers()).resolves.toEqual([{ payerId: PAYER, firstName: "Chinedu", entitlementIds: ["e1"] }]);
    mockRpc.mockResolvedValueOnce({ data: null, error: { message: "x" } });
    await expect(loadGiftPayers()).resolves.toEqual([]);
    expect(parseGiftPayers({})).toEqual([]);
  });
  it("a re-read keeps a payer already on screen", () => {
    const a = { payerId: PAYER, firstName: "Chinedu", entitlementIds: ["e1"] };
    expect(mergeKeepingShown([a], [])).toEqual([a]);
    expect(mergeKeepingShown([a], [{ ...a, entitlementIds: ["e2"] }])[0]!.entitlementIds).toEqual(["e1", "e2"]);
  });
});

describe("Not now, and the patient's own notes (patient first)", () => {
  const NOTE = "6a1f0c1e-2b3d-4e5f-8a9b-0c1d2e3f4a5b";
  it("Not now is remembered for a real payer id only", async () => {
    await expect(dismissGiftPayer("x")).resolves.toBe(false);
    expect(mockRpc).not.toHaveBeenCalled();
    mockRpc.mockResolvedValueOnce({ data: true, error: null });
    await expect(dismissGiftPayer(PAYER)).resolves.toBe(true);
    expect(mockRpc).toHaveBeenCalledWith("dismiss_gift_payer_offer", { p_payer: PAYER });
  });
  it("reads the patient's notes and drops a malformed one; a failed read is none", async () => {
    const row = { note_id: NOTE, body: "Well done.", written_at: "2026-11-03T10:00:00Z", author_staff_id: null, author_name: null, shared: false, decided: false };
    mockRpc.mockResolvedValueOnce({ data: [row, { ...row, shared: "no" }], error: null });
    const out = await loadMyFamilyNotes();
    expect(out).toHaveLength(1);
    expect(out[0]!.shared).toBe(false);
    mockRpc.mockResolvedValueOnce({ data: null, error: { message: "x" } });
    await expect(loadMyFamilyNotes()).resolves.toEqual([]);
    expect(parseMyFamilyNotes("x")).toEqual([]);
  });
  it("share or un-share sends the patient's choice; a failure is null, never a guess", async () => {
    mockRpc.mockResolvedValueOnce({ data: true, error: null });
    await expect(setFamilyNoteShared(NOTE, true)).resolves.toBe(true);
    expect(mockRpc).toHaveBeenCalledWith("set_family_note_shared", { p_note: NOTE, p_share: true });
    mockRpc.mockResolvedValueOnce({ data: null, error: { message: "family_note_not_found" } });
    await expect(setFamilyNoteShared(NOTE, false)).resolves.toBeNull();
    await expect(setFamilyNoteShared("bad", true)).resolves.toBeNull();
  });
});

describe("the doctor's line for the family", () => {
  const base = { patient_id: "p", name: "Mama", shared_until: "2027-01-01T00:00:00Z" };
  it("absent means not shared, null means none yet, a note is kept with its date", () => {
    expect(parseSupporterView(base)?.doctorNote).toBeUndefined();
    expect(parseSupporterView({ ...base, doctor_note: null })?.doctorNote).toBeNull();
    const v = parseSupporterView({ ...base, doctor_note: { body: "Well done today.", written_at: "2026-11-03T10:00:00Z", author_staff_id: "s1", author_name: "Dr Amara Eze" } });
    expect(v?.doctorNote).toEqual({ body: "Well done today.", writtenAt: "2026-11-03T10:00:00Z", authorStaffId: "s1", authorName: "Dr Amara Eze" });
  });
  it("an over-long note is dropped, never shown half-wrong", () => {
    expect(parseSupporterView({ ...base, doctor_note: { body: "a".repeat(281), written_at: "x" } })?.doctorNote).toBeUndefined();
  });
  it("null-gated: a name is shown only with the author's id", () => {
    expect(familyNoteAuthor({ authorStaffId: "s1", authorName: "Dr Amara Eze" })).toBe("Dr Amara Eze");
    expect(familyNoteAuthor({ authorStaffId: null, authorName: "Dr Amara Eze" })).toBeNull();
    expect(familyNoteAuthor({ authorStaffId: "s1", authorName: null })).toBeNull();
  });
});
