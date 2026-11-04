/**
 * Care Circle P1-P3 on the phone (mobile parity with the web, 2026-11-04): payer offers, the patient's history of sharing changes, the
 * paused help alert, the P2 supporter blocks (tests, reviewed results, weight, yearly check-ups), the person switcher and P3 help
 * requests (recipients, note, "I can't help"). Parsing is tolerant like the web: an unknown permission or change is dropped, never a row.
 */
import { en } from "@tarragon/i18n";
import { testCodeLabel } from "@tarragon/shared";
import {
  SHARING_CHANGES, parseGiftPayers, parseGiftShareResult, parseMyCircle, parseRespondOffer, parseShareOffers, parseSharingHistory, parseSupporterView, parseTasks,
  parseInvitePreview, sharingChangeKey,
} from "./parse";
import { hasSharedBlocks, resultValueText, showPersonSwitcher } from "./supporter-home";
import { taskAnswerKey, toggleRecipient } from "./tasks";
import { parseHelpAlert, showSentPaused } from "./help-alert";

const mockRpc = jest.fn();
jest.mock("../supabase", () => ({ supabase: { rpc: (...a: unknown[]) => mockRpc(...a) } }));
import { loadShareOffers, loadSharingHistory, postTask, respondToShareOffer, shareWithGiftPayer, taskAction, withdrawShareOffer } from "./api";

const M1 = "3f6c1d2e-4a5b-4c6d-8e7f-9a0b1c2d3e4f";
const M2 = "5b4a3c2d-1e0f-4a9b-8c7d-6e5f4a3b2c1d";
const PAYER = "8b0e1f4e-7d55-4a9b-9a51-1f5f0d6b2c11";
beforeEach(() => mockRpc.mockReset());

describe("P1 payer offers", () => {
  const offer = { member_id: M1, patient_id: "p1", name: "Ada", permissions: ["red_alerts", "future_thing"], monthly_report: true, offered_at: "2026-11-04T09:00:00Z", answer_by: "2026-11-18T09:00:00Z" };
  it("reads an offer, drops an unknown permission (never the row), and drops a malformed row", () => {
    expect(parseShareOffers([offer, { member_id: "not-a-uuid", name: "X" }, "junk"])).toEqual([
      { memberId: M1, patientId: "p1", name: "Ada", permissions: ["red_alerts"], monthlyReport: true, offeredAt: "2026-11-04T09:00:00Z", answerBy: "2026-11-18T09:00:00Z" },
    ]);
    expect(parseShareOffers(null)).toEqual([]);
  });
  it("loads offers; a failed read is none (an offer is never a required step)", async () => {
    mockRpc.mockResolvedValueOnce({ data: [offer], error: null });
    await expect(loadShareOffers()).resolves.toHaveLength(1);
    expect(mockRpc).toHaveBeenCalledWith("my_circle_share_offers");
    mockRpc.mockResolvedValueOnce({ data: null, error: { message: "x" } });
    await expect(loadShareOffers()).resolves.toEqual([]);
  });
  it("yes or no: only a clean answer counts; a bad id is never sent", async () => {
    expect(parseRespondOffer({ ok: true, accepted: false })).toEqual({ accepted: false });
    expect(parseRespondOffer({ ok: true })).toBeNull();
    mockRpc.mockResolvedValueOnce({ data: { ok: true, accepted: true }, error: null });
    await expect(respondToShareOffer(M1, true)).resolves.toEqual({ accepted: true });
    expect(mockRpc).toHaveBeenCalledWith("respond_to_circle_share_offer", { p_member: M1, p_accept: true });
    mockRpc.mockResolvedValueOnce({ data: null, error: { message: "offer_not_open" } });
    await expect(respondToShareOffer(M1, false)).resolves.toBeNull();
    mockRpc.mockClear();
    await expect(respondToShareOffer("bad", true)).resolves.toBeNull();
    expect(mockRpc).not.toHaveBeenCalled();
  });
  it("the patient's waiting offers come with my_care_circle, tolerant of unknown permissions", () => {
    const c = parseMyCircle({ members: [], invites: [], offers: [{ member_id: M1, name: "Ada", permissions: ["appointments", "zzz"], answer_by: "2026-11-18", state: "offered" }, { name: "no id" }] });
    expect(c.offers).toEqual([{ memberId: M1, name: "Ada", permissions: ["appointments"], answerBy: "2026-11-18" }]);
    expect(parseMyCircle({ members: [], invites: [] }).offers).toEqual([]);
  });
  it("withdraw: only a clean true, never for a bad id", async () => {
    mockRpc.mockResolvedValueOnce({ data: true, error: null });
    await expect(withdrawShareOffer(M1)).resolves.toBe(true);
    expect(mockRpc).toHaveBeenCalledWith("withdraw_circle_share_offer", { p_member: M1 });
    mockRpc.mockResolvedValueOnce({ data: false, error: null });
    await expect(withdrawShareOffer(M1)).resolves.toBe(false);
    mockRpc.mockClear();
    await expect(withdrawShareOffer("x")).resolves.toBe(false);
    expect(mockRpc).not.toHaveBeenCalled();
  });
  it("a payer already asked is marked waiting; the gift share says invited vs widened", async () => {
    expect(parseGiftPayers([{ payer_id: PAYER, first_name: "Chinedu", entitlement_ids: ["e1"], offer_pending: true }])[0]?.offerPending).toBe(true);
    expect(parseGiftPayers([{ payer_id: PAYER, first_name: null, entitlement_ids: [] }])[0]?.offerPending).toBe(false);
    expect(parseGiftShareResult({ ok: true, offered: true })).toEqual({ offered: true });
    expect(parseGiftShareResult({ ok: true, member_id: "m" })).toEqual({ offered: false });
    expect(parseGiftShareResult({ ok: false })).toBeNull();
    mockRpc.mockResolvedValueOnce({ data: { ok: true, offered: true }, error: null });
    await expect(shareWithGiftPayer(PAYER, ["red_alerts"], false)).resolves.toEqual({ ok: true, offered: true });
  });
});

describe("P1 sharing history", () => {
  it("maps every change code to a copy key that exists, exactly like the web", () => {
    for (const c of SHARING_CHANGES) {
      for (const by of ["patient", "supporter", "system"] as const) expect(Object.hasOwn(en, sharingChangeKey(c, by))).toBe(true);
    }
    expect(sharingChangeKey("revoked", "supporter")).toBe("circlep1.history.left");
    expect(sharingChangeKey("revoked", "patient")).toBe("circlep1.history.revoked");
    expect(sharingChangeKey("offer_lapsed", "system")).toBe("circlep1.history.offer_lapsed");
  });
  it("drops an unknown change, and a row only when nothing in it is known", () => {
    const rows = parseSharingHistory([
      { at: "2026-11-04T10:00:00Z", changes: ["added", "teleported"], by: "patient", supporter: "Ada", permissions: [], previous_permissions: null },
      { at: "2026-11-04T11:00:00Z", changes: ["teleported"], by: "patient", supporter: null },
      { at: "2026-11-04T12:00:00Z", changes: ["paused"], by: "robot", supporter: null },
      { at: "2026-11-04T13:00:00Z", changes: ["revoked"], by: "supporter", supporter: null },
    ]);
    expect(rows).toEqual([
      { at: "2026-11-04T10:00:00Z", changes: ["added"], by: "patient", supporter: "Ada" },
      { at: "2026-11-04T13:00:00Z", changes: ["revoked"], by: "supporter", supporter: null },
    ]);
    expect(parseSharingHistory({})).toEqual([]);
  });
  it("loads the patient's own history (50 newest); a failure is an error, never 'no changes'", async () => {
    mockRpc.mockResolvedValueOnce({ data: [], error: null });
    await expect(loadSharingHistory()).resolves.toEqual({ ok: true, data: [] });
    expect(mockRpc).toHaveBeenCalledWith("my_circle_sharing_history", { p_limit: 50 });
    mockRpc.mockResolvedValueOnce({ data: null, error: { message: "boom" } });
    await expect(loadSharingHistory()).resolves.toEqual({ ok: false, error: "boom" });
  });
});

describe("P1 help alert while paused", () => {
  it("reads circle_paused, and says 'still sent' only when someone was told", () => {
    const r = parseHelpAlert({ already_sent: false, recipients_told: 2, location_shared: false, circle_paused: true });
    expect(r?.circlePaused).toBe(true);
    expect(r && showSentPaused(r)).toBe(true);
    const none = parseHelpAlert({ already_sent: false, recipients_told: 0, location_shared: false, circle_paused: true });
    expect(none && showSentPaused(none)).toBe(false);
    expect(parseHelpAlert({ already_sent: false, recipients_told: 1, location_shared: false })?.circlePaused).toBe(false);
  });
});

describe("P2 supporter blocks", () => {
  const base = { patient_id: "p", name: "Mama", shared_until: "2027-01-01T00:00:00Z" };
  it("reads tests, reviewed results, weight and yearly check-ups field by field; a bad row is dropped, never the block", () => {
    const v = parseSupporterView({
      ...base,
      investigations: [{ code: "hba1c", stage: "awaiting_review", due_date: null, follow_up: true }, { code: "x", stage: "teleported", due_date: null, follow_up: false }],
      results: [
        { code: "lipid_panel", at: "2026-10-01", value: 5.2, value_text: null, unit: "mmol/L", ref_low: null, ref_high: 5.0, in_range: false },
        { code: "hiv", at: "2026-10-01", value: null, value_text: null, unit: "" },
      ],
      weight_trend: { weeks: [{ week_start: "2026-10-26", kg: 81.5, readings: 3 }, { week_start: "2026-11-02", kg: null, readings: 0 }], direction: "lower" },
      plan_progress: { done: 2, due: 3, overdue: 1, next_due: "2026-12-01" },
      stray: "never shown",
    });
    expect(v?.investigations).toEqual([{ code: "hba1c", stage: "awaiting_review", dueDate: null, followUp: true }]);
    expect(v?.results).toEqual([{ code: "lipid_panel", at: "2026-10-01", value: 5.2, valueText: null, unit: "mmol/L", refLow: null, refHigh: 5.0, inRange: false }]);
    expect(v?.weightTrend).toEqual({ weeks: [{ weekStart: "2026-10-26", kg: 81.5, readings: 3 }, { weekStart: "2026-11-02", kg: null, readings: 0 }], direction: "lower" });
    expect(v?.planProgress).toEqual({ done: 2, due: 3, overdue: 1, nextDue: "2026-12-01" });
    expect(JSON.stringify(v)).not.toMatch(/never shown/);
  });
  it("absent means not shared; shared but empty still counts as something to show (like the web)", () => {
    const v = parseSupporterView(base);
    expect(v?.investigations).toBeUndefined();
    expect(v && hasSharedBlocks(v, "en")).toBe(false);
    expect(hasSharedBlocks({ investigations: [] }, "en")).toBe(true);
    expect(hasSharedBlocks({ results: [] }, "en")).toBe(true);
    expect(hasSharedBlocks({ weightTrend: { weeks: [], direction: null } }, "en")).toBe(true);
    expect(hasSharedBlocks({ planProgress: { done: 0, due: 0, overdue: 0, nextDue: null } }, "en")).toBe(true);
  });
  it("a value reads as number and unit, or the lab's own words; test codes read as plain names", () => {
    expect(resultValueText({ value: 6.1, valueText: null, unit: "%" })).toBe("6.1 %");
    expect(resultValueText({ value: null, valueText: "Negative", unit: "" })).toBe("Negative");
    expect(testCodeLabel("hba1c")).toBe("Average blood sugar (HbA1c)");
    expect(testCodeLabel("urine_acr")).toBe("Urine protein check (ACR)");
    expect(testCodeLabel("new_code")).toBe("New code");
  });
  it("every stage and weight direction has CMO-approved copy", () => {
    for (const s of ["due", "overdue", "requested", "awaiting_result", "result_received", "awaiting_review", "reviewed", "done"]) expect(Object.hasOwn(en, `circlep2.stage.${s}`)).toBe(true);
    for (const d of ["higher", "lower", "steady"]) expect(Object.hasOwn(en, `circlep2.weight.${d}`)).toBe(true);
  });
  it("the person switcher shows only for a supporter of two or more people", () => {
    expect(showPersonSwitcher([])).toBe(false);
    expect(showPersonSwitcher([1])).toBe(false);
    expect(showPersonSwitcher([1, 2])).toBe(true);
  });
  it("the invitation preview stays strict: one unknown permission means the app cannot show it", () => {
    expect(parseInvitePreview({ ok: true, inviter_first_name: "A", relationship: "Son", permissions: ["red_alerts", "zzz"] })).toEqual({ ok: false });
  });
});

describe("P3 help requests", () => {
  it("reads the note, who it was asked of, each answer, my answer and the decline flag", () => {
    const list = parseTasks({
      role: "patient",
      tasks: [{
        task_id: "t1", kind: "other", needed_by: null, state: "open", note: "Bring my glasses", addressed: true,
        recipients: [{ name: "Ada", answer: "cannot_help" }, { name: "Obi", answer: null }, { name: 5 }], my_answer: null, can_decline: false,
      }],
    });
    expect(list?.tasks[0]).toMatchObject({ note: "Bring my glasses", addressed: true, recipients: [{ name: "Ada", answer: "cannot_help" }, { name: "Obi", answer: null }], myAnswer: null, canDecline: false });
    const helper = parseTasks({ role: "viewer", tasks: [{ task_id: "t2", kind: "visit", needed_by: null, state: "open", addressed: true, recipients: null, my_answer: "cannot_help", can_decline: true }] });
    expect(helper?.tasks[0]).toMatchObject({ note: null, addressed: true, recipients: null, myAnswer: "cannot_help", canDecline: true });
  });
  it("answer lines use the shared copy", () => {
    expect(taskAnswerKey("can_help")).toBe("cctools.tasks.answer.can_help");
    expect(taskAnswerKey("cannot_help")).toBe("cctools.tasks.answer.cannot_help");
    expect(taskAnswerKey(null)).toBe("cctools.tasks.answer.waiting");
    expect(toggleRecipient([M1], M2)).toEqual([M1, M2]);
    expect(toggleRecipient([M1, M2], M1)).toEqual([M2]);
  });
  it("sends recipients (membership ids) and a trimmed note only when given", async () => {
    mockRpc.mockResolvedValue({ data: "t", error: null });
    await expect(postTask("p", "errand", "2026-11-10", { recipients: [M1, M2, M1], note: "  bread please " })).resolves.toEqual({ ok: true });
    expect(mockRpc).toHaveBeenLastCalledWith("post_circle_task", { p_patient: "p", p_kind: "errand", p_needed_by: "2026-11-10", p_recipients: [M1, M2], p_note: "bread please" });
    await postTask("p", "visit", null, { recipients: [], note: "   " });
    expect(mockRpc).toHaveBeenLastCalledWith("post_circle_task", { p_patient: "p", p_kind: "visit" });
  });
  it("fails closed: a request for chosen people is never widened to everyone because an id is unreadable", async () => {
    await expect(postTask("p", "errand", null, { recipients: ["junk"] })).resolves.toEqual({ ok: false, reason: "error" });
    await expect(postTask("p", "errand", null, { recipients: [M1, "junk"] })).resolves.toEqual({ ok: false, reason: "error" });
    expect(mockRpc).not.toHaveBeenCalled();
  });
  it("'other' needs a note and a note is at most 140 characters, checked before sending", async () => {
    await expect(postTask("p", "other", null, { note: " " })).resolves.toEqual({ ok: false, reason: "note_needed" });
    await expect(postTask("p", "errand", null, { note: "a".repeat(141) })).resolves.toEqual({ ok: false, reason: "note_too_long" });
    expect(mockRpc).not.toHaveBeenCalled();
    mockRpc.mockResolvedValueOnce({ data: null, error: { message: "task_other_needs_note" } });
    // the database says the same thing (e.g. a note of only characters it strips)
    await expect(postTask("p", "other", null, { note: "x" })).resolves.toEqual({ ok: false, reason: "note_needed" });
  });
  it("'I can't help' goes through decline_circle_task", async () => {
    mockRpc.mockResolvedValueOnce({ data: true, error: null });
    await expect(taskAction("decline_circle_task", "t1")).resolves.toBe(true);
    expect(mockRpc).toHaveBeenCalledWith("decline_circle_task", { p_task: "t1" });
  });
});
