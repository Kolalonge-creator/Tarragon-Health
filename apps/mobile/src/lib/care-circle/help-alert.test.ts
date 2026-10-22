const mockRpc = jest.fn();
const mockMaybeSingle = jest.fn();
jest.mock("../supabase", () => ({
  supabase: {
    rpc: (...a: unknown[]) => mockRpc(...a),
    from: () => ({ select: () => ({ maybeSingle: () => mockMaybeSingle() }) }),
  },
}));

import { loadLocationConsent, parseHelpAlert, revokeLocationConsent, sendHelpAlert } from "./help-alert";

beforeEach(() => {
  mockRpc.mockReset();
  mockMaybeSingle.mockReset();
});

describe("parseHelpAlert", () => {
  it("reads the function's answer", () => {
    expect(parseHelpAlert({ already_sent: false, recipients_told: 2, location_shared: false })).toEqual({ alreadySent: false, recipientsTold: 2, locationShared: false });
  });
  it("never turns something unexpected into a success", () => {
    expect(parseHelpAlert(null)).toBeNull();
    expect(parseHelpAlert("ok")).toBeNull();
    expect(parseHelpAlert({ recipients_told: 3 })).toBeNull();
  });
  it("reads a missing count as nobody told, and only true as shared", () => {
    expect(parseHelpAlert({ already_sent: true, location_shared: "yes" })).toEqual({ alreadySent: true, recipientsTold: 0, locationShared: false });
  });
});

describe("sendHelpAlert", () => {
  it("sends no coordinates from the phone", async () => {
    mockRpc.mockResolvedValue({ data: { already_sent: false, recipients_told: 1, location_shared: false }, error: null });
    const out = await sendHelpAlert();
    expect(mockRpc).toHaveBeenCalledWith("send_circle_help_alert", {});
    expect(out).toEqual({ ok: true, result: { alreadySent: false, recipientsTold: 1, locationShared: false } });
  });
  it("tells a closed guard from a daily limit from a failure", async () => {
    mockRpc.mockResolvedValue({ data: null, error: { code: "55000" } });
    expect(await sendHelpAlert()).toEqual({ ok: false, notOpen: true, tooMany: false });
    mockRpc.mockResolvedValue({ data: null, error: { code: "54000" } });
    expect(await sendHelpAlert()).toEqual({ ok: false, notOpen: false, tooMany: true });
    mockRpc.mockResolvedValue({ data: null, error: { code: "XX000" } });
    expect(await sendHelpAlert()).toEqual({ ok: false, notOpen: false, tooMany: false });
  });
  it("treats an unreadable success as a failure so the fallback advice shows", async () => {
    mockRpc.mockResolvedValue({ data: { weird: true }, error: null });
    expect((await sendHelpAlert()).ok).toBe(false);
  });
});

describe("location consent", () => {
  it("reads missing row and failed read as off", async () => {
    mockMaybeSingle.mockResolvedValue({ data: null, error: null });
    expect(await loadLocationConsent()).toBe(false);
    mockMaybeSingle.mockResolvedValue({ data: null, error: { message: "x" } });
    expect(await loadLocationConsent()).toBe(false);
    mockMaybeSingle.mockResolvedValue({ data: { granted: true }, error: null });
    expect(await loadLocationConsent()).toBe(true);
  });
  it("only ever withdraws consent from the phone", async () => {
    mockRpc.mockResolvedValue({ error: null });
    expect(await revokeLocationConsent()).toBe(true);
    expect(mockRpc).toHaveBeenCalledWith("set_circle_location_consent", { p_granted: false });
  });
});
