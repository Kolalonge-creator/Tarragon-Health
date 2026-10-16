import { PLATFORM_URL } from "@/lib/platform-url";
import { clearPendingJoinToken, offerUrl, parseJoinLink, setPendingJoinToken } from "./join-link";
import {
  circleErrorKey, minutesLeft, needsAttentionCount, parseAcceptInvite, parseCheckInPending, parseCheckInResult, parseInvitePreview, parseUnanswered, type OpenAlert,
} from "./parse";

const mockRpc = jest.fn();
jest.mock("../supabase", () => ({ supabase: { rpc: (...a: unknown[]) => mockRpc(...a) } }));
import { ackUnanswered, acceptInvite, answerCheckIn, checkInWindowOpen, loadCheckInPending, loadUnanswered, previewInvite, requestCheckIn } from "./api";

beforeEach(() => mockRpc.mockReset());

const TOKEN = "abcDEF123_-abcDEF123_-abcDEF123_-xyz"; // base64url, 36 characters

describe("join links (S29e)", () => {
  it("reads the app scheme, the web path under the scheme, and the shared https link", () => {
    expect(parseJoinLink(`tarragonhealth://join/${TOKEN}`)).toBe(TOKEN);
    expect(parseJoinLink(`tarragonhealth://patient/supporting/join/${TOKEN}`)).toBe(TOKEN);
    expect(parseJoinLink(`${PLATFORM_URL}/patient/supporting/join/${TOKEN}`)).toBe(TOKEN);
    expect(parseJoinLink(`tarragonhealth://join/${TOKEN}/`)).toBe(TOKEN);
  });

  it("refuses anything that is not a join link", () => {
    expect(parseJoinLink(null)).toBeNull();
    expect(parseJoinLink("")).toBeNull();
    expect(parseJoinLink("tarragonhealth://join/short")).toBeNull();
    expect(parseJoinLink(`https://evil.example/patient/supporting/join/${TOKEN}`)).toBeNull();
    expect(parseJoinLink(`${PLATFORM_URL.replace("https:", "http:")}/patient/supporting/join/${TOKEN}`)).toBeNull();
    expect(parseJoinLink(`tarragonhealth://pay/${TOKEN}`)).toBeNull();
    expect(parseJoinLink(`tarragonhealth://join/${TOKEN}%00bad`)).toBeNull();
    expect(parseJoinLink(`tarragonhealth://join/%E0%A4%A`)).toBeNull();
    expect(parseJoinLink(`tarragonhealth://join/${"a".repeat(700)}`)).toBeNull();
  });

  it("keeps the token only until it is used", () => {
    expect(offerUrl("https://example.com")).toBe(false);
    expect(offerUrl(`tarragonhealth://join/${TOKEN}`)).toBe(true);
    clearPendingJoinToken();
    setPendingJoinToken(null);
  });
});

describe("invite preview and accept", () => {
  it("parses what is on offer and whether payment is off the table abroad", () => {
    expect(parseInvitePreview({ ok: true, inviter_first_name: "Ada", relationship: "Daughter", permissions: ["adherence_summary"], cross_organisation: true }))
      .toEqual({ ok: true, inviterFirstName: "Ada", relationship: "Daughter", permissions: ["adherence_summary"], crossOrganisation: true });
    expect(parseInvitePreview({ ok: true, inviter_first_name: "Ada", relationship: "Daughter", permissions: ["red_alerts"] }))
      .toMatchObject({ ok: true, crossOrganisation: false });
  });

  it("every failure is the same silent no", () => {
    expect(parseInvitePreview({ ok: false })).toEqual({ ok: false });
    expect(parseInvitePreview(null)).toEqual({ ok: false });
    expect(parseInvitePreview({ ok: true, inviter_first_name: "Ada", relationship: "x", permissions: ["not_a_permission"] })).toEqual({ ok: false });
    expect(parseAcceptInvite({ ok: false })).toEqual({ ok: false });
    expect(parseAcceptInvite({ ok: true })).toEqual({ ok: false });
    expect(parseAcceptInvite({ ok: true, patient_id: "p" })).toEqual({ ok: true, patientId: "p" });
  });

  it("calls the database with the token and treats an error as the silent no", async () => {
    mockRpc.mockResolvedValueOnce({ data: { ok: true, inviter_first_name: "Ada", relationship: "Son", permissions: ["red_alerts"] }, error: null });
    expect(await previewInvite(TOKEN)).toMatchObject({ ok: true });
    expect(mockRpc).toHaveBeenCalledWith("preview_care_circle_invite", { p_token: TOKEN });
    // a failed call is "unreachable" (worth a retry), not the permanent "this link does not work"
    mockRpc.mockResolvedValueOnce({ data: null, error: { message: "boom" } });
    expect(await previewInvite(TOKEN)).toBe("unreachable");
    mockRpc.mockResolvedValueOnce({ data: { ok: false }, error: null });
    expect(await previewInvite(TOKEN)).toEqual({ ok: false });
    mockRpc.mockResolvedValueOnce({ data: { ok: true, patient_id: "p" }, error: null });
    expect(await acceptInvite(TOKEN)).toEqual({ ok: true, patientId: "p" });
    mockRpc.mockResolvedValueOnce({ data: null, error: { message: "boom" } });
    expect(await acceptInvite(TOKEN)).toBe("unreachable");
  });
});

describe("needs-attention count (the backup for the push)", () => {
  const alert = (called: boolean): OpenAlert => ({ patientId: "p", name: "Mum", since: "t", called });
  it("counts only people nobody has marked as called", () => {
    expect(needsAttentionCount([])).toBe(0);
    expect(needsAttentionCount([alert(false), alert(true), alert(false)])).toBe(1);
    const other = { ...alert(false), patientId: "q" };
    expect(needsAttentionCount([alert(false), other])).toBe(2);
    // one person with both an open request and an unanswered check-in is one person
    expect(needsAttentionCount([alert(false)], [{ patientId: "p" }, { patientId: "z" }])).toBe(2);
  });
});

describe("check-in window (non-emergency)", () => {
  it("parses the three answers and refuses anything else", () => {
    expect(parseCheckInResult({ ok: true, window_ends_at: "t" })).toEqual({ ok: true, windowEndsAt: "t" });
    expect(parseCheckInResult({ ok: true })).toBeNull();
    expect(parseCheckInResult({ ok: false, reason: "limit" })).toEqual({ ok: false, reason: "limit" });
    expect(parseCheckInResult({ ok: false, reason: "already_waiting" })).toEqual({ ok: false, reason: "already_waiting" });
    expect(parseCheckInResult({ ok: false, reason: "surprise" })).toBeNull();
    expect(parseCheckInResult(null)).toBeNull();
    expect(parseCheckInPending({ waiting: true })).toBe(true);
    expect(parseCheckInPending({ waiting: false })).toBe(false);
    expect(parseCheckInPending("yes")).toBe(false);
  });

  it("reads closed on any failure, never open by accident", async () => {
    mockRpc.mockResolvedValueOnce({ data: true, error: null });
    expect(await checkInWindowOpen()).toBe(true);
    // a failed read is null (unknown): the supporter's button needs a clear true, the patient's answer path needs a clear false to close
    mockRpc.mockResolvedValueOnce({ data: null, error: { message: "x" } });
    expect(await checkInWindowOpen()).toBeNull();
    mockRpc.mockResolvedValueOnce({ data: "true", error: null });
    expect(await checkInWindowOpen()).toBe(false);
  });

  it("a request that did not save is null, never a success", async () => {
    mockRpc.mockResolvedValueOnce({ data: null, error: { message: "circle_checkin_unavailable" } });
    expect(await requestCheckIn("p")).toBeNull();
    mockRpc.mockResolvedValueOnce({ data: { ok: true, window_ends_at: "t" }, error: null });
    expect(await requestCheckIn("p")).toEqual({ ok: true, windowEndsAt: "t" });
    expect(mockRpc).toHaveBeenLastCalledWith("request_circle_check_in", { p_patient: "p" });
  });

  it("the patient's answer and pending check", async () => {
    mockRpc.mockResolvedValueOnce({ data: { waiting: true }, error: null });
    expect(await loadCheckInPending()).toBe(true);
    // a failed read is null, never "nothing is waiting"
    mockRpc.mockResolvedValueOnce({ data: null, error: { message: "x" } });
    expect(await loadCheckInPending()).toBeNull();
    // an answer lands (true), arrives too late (false), or is not saved (null)
    mockRpc.mockResolvedValueOnce({ data: true, error: null });
    expect(await answerCheckIn()).toBe(true);
    mockRpc.mockResolvedValueOnce({ data: false, error: null });
    expect(await answerCheckIn()).toBe(false);
    mockRpc.mockResolvedValueOnce({ data: null, error: { message: "x" } });
    expect(await answerCheckIn()).toBeNull();
  });

  it("people who did not answer are name and time only", async () => {
    expect(parseUnanswered([{ patient_id: "a", name: "Mum", since: "t", reading: "182/112" }, { nope: 1 }])).toEqual([{ patientId: "a", name: "Mum", since: "t" }]);
    expect(parseUnanswered("x")).toEqual([]);
    mockRpc.mockResolvedValueOnce({ data: [{ patient_id: "a", name: "Mum", since: "t" }], error: null });
    expect(await loadUnanswered()).toEqual({ ok: true, data: [{ patientId: "a", name: "Mum", since: "t" }] });
    mockRpc.mockResolvedValueOnce({ data: null, error: { message: "x" } });
    expect((await loadUnanswered()).ok).toBe(false);
  });

  it("minutes left come from the end time the database sent, never below one", () => {
    const now = Date.parse("2026-10-16T10:00:00Z");
    expect(minutesLeft("2026-10-16T10:10:00Z", now)).toBe(10);
    expect(minutesLeft("2026-10-16T09:00:00Z", now)).toBe(1);
    expect(minutesLeft("garbage", now)).toBeNull();
  });

  it("'I called them' for a person who did not answer is one call, true only when the database says so", async () => {
    mockRpc.mockResolvedValueOnce({ data: true, error: null });
    expect(await ackUnanswered("p")).toBe(true);
    expect(mockRpc).toHaveBeenLastCalledWith("circle_ack_unanswered", { p_patient: "p" });
    mockRpc.mockResolvedValueOnce({ data: null, error: { message: "circle_not_found" } });
    expect(await ackUnanswered("p")).toBe(false);
  });

  it("a supporter abroad left with no view permission has its own message", () => {
    expect(circleErrorKey("circle_cross_org_needs_a_view_permission")).toBe("circle.error.cross_org_needs_view");
  });
});
