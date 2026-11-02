import { beforeEach, describe, expect, it, jest } from "@jest/globals";

const getCurrentProfile = jest.fn<() => Promise<{ id: string } | null>>();
const getCallerPermissions = jest.fn<() => Promise<{ isSuperAdmin: boolean }>>();
const fdRpc = jest.fn<(s: unknown, fn: string, args: Record<string, unknown>) => Promise<{ error: string | null }>>();
const fdRpcData = jest.fn<(s: unknown, fn: string, args?: Record<string, unknown>) => Promise<{ data: unknown; error: string | null }>>();
jest.mock("next/cache", () => ({ revalidatePath: jest.fn() }));
jest.mock("server-only", () => ({}));
jest.mock("@/lib/auth/current-profile", () => ({ getCurrentProfile: () => getCurrentProfile() }));
jest.mock("@/lib/auth/permissions", () => ({ getCallerPermissions: () => getCallerPermissions() }));
jest.mock("@/lib/supabase/server", () => ({ createClient: async () => ({}) }));
jest.mock("@/lib/frontdesk/raw-db", () => ({
  fdRpc: (s: unknown, fn: string, a: Record<string, unknown>) => fdRpc(s, fn, a),
  fdRpcData: (s: unknown, fn: string, a?: Record<string, unknown>) => fdRpcData(s, fn, a),
}));

import { generateReportNowAction, setAssistantSwitchAction, setSamplePercentAction } from "./actions";
import { closeIncidentAction, recordReviewAction } from "./reviews/actions";

const form = (entries: [string, string][]) => {
  const f = new FormData();
  for (const [k, v] of entries) f.append(k, v);
  return f;
};
const ID = "11111111-1111-4111-8111-111111111111";

beforeEach(() => {
  jest.clearAllMocks();
  getCurrentProfile.mockResolvedValue({ id: "u1" });
  getCallerPermissions.mockResolvedValue({ isSuperAdmin: true });
  fdRpc.mockResolvedValue({ error: null });
  fdRpcData.mockResolvedValue({ data: null, error: null });
});

describe("only an admin gets through (the database checks again)", () => {
  it.each([
    ["kill switch", () => setAssistantSwitchAction(undefined, form([["enabled", "false"]]))],
    ["sample share", () => setSamplePercentAction(undefined, form([["percent", "50"]]))],
    ["report now", () => generateReportNowAction(undefined)],
    ["record review", () => recordReviewAction(undefined, form([["reviewId", ID], ["verdict", "ok"]]))],
    ["close incident", () => closeIncidentAction(undefined, form([["incidentId", ID], ["ruleChange", "Added the dose words to the rules"]]))],
  ])("%s refuses a non-admin and does nothing", async (_n, run) => {
    getCallerPermissions.mockResolvedValue({ isSuperAdmin: false });
    expect(await run()).toEqual({ error: expect.stringMatching(/admin/i) });
    expect(fdRpc).not.toHaveBeenCalled();
    expect(fdRpcData).not.toHaveBeenCalled();
  });
  it("refuses someone not signed in", async () => {
    getCurrentProfile.mockResolvedValue(null);
    expect(await setAssistantSwitchAction(undefined, form([["enabled", "true"]]))).toEqual({ error: "Not signed in" });
  });
});

describe("kill switch", () => {
  it("switches the assistant off and says visitors now see the form", async () => {
    const r = await setAssistantSwitchAction(undefined, form([["enabled", "false"]]));
    expect(fdRpc).toHaveBeenCalledWith({}, "fd_set_config", { p_key: "assistant_enabled", p_value: false });
    expect(r?.done).toMatch(/contact form/);
  });
  it("switches it on", async () => {
    await setAssistantSwitchAction(undefined, form([["enabled", "true"]]));
    expect(fdRpc).toHaveBeenCalledWith({}, "fd_set_config", { p_key: "assistant_enabled", p_value: true });
  });
  it("refuses a value that is not true or false", async () => {
    expect(await setAssistantSwitchAction(undefined, form([["enabled", "maybe"]]))).toEqual({ error: "Invalid request" });
    expect(fdRpc).not.toHaveBeenCalled();
  });
  it("returns the database's error", async () => {
    fdRpc.mockResolvedValue({ error: "boom" });
    expect(await setAssistantSwitchAction(undefined, form([["enabled", "true"]]))).toEqual({ error: "boom" });
  });
});

describe("sample share", () => {
  it("sets a listed share as a number", async () => {
    await setSamplePercentAction(undefined, form([["percent", "25"]]));
    expect(fdRpc).toHaveBeenCalledWith({}, "fd_set_config", { p_key: "review_sample_percent", p_value: 25 });
  });
  it("says what 100 means", async () => {
    expect((await setSamplePercentAction(undefined, form([["percent", "100"]])))?.done).toMatch(/Every conversation/);
  });
  it("refuses a share that is not offered", async () => {
    expect((await setSamplePercentAction(undefined, form([["percent", "101"]])))?.error).toBeTruthy();
    expect(fdRpc).not.toHaveBeenCalled();
  });
});

describe("report now", () => {
  it("asks the database for a report and says it is on its way", async () => {
    fdRpcData.mockResolvedValue({ data: { id: ID, created: true, status: "pending" }, error: null });
    expect((await generateReportNowAction(undefined))?.done).toMatch(/emailed to you within a few minutes/);
    expect(fdRpcData).toHaveBeenCalledWith({}, "fd_report_generate_now", undefined);
  });
  it("says so, instead of promising an email, when today's report was already sent", async () => {
    fdRpcData.mockResolvedValue({ data: { id: ID, created: false, status: "sent" }, error: null });
    expect((await generateReportNowAction(undefined))?.done).toMatch(/already made and emailed/);
  });
  it("a retried failed report is on its way again", async () => {
    fdRpcData.mockResolvedValue({ data: { id: ID, created: false, status: "pending" }, error: null });
    expect((await generateReportNowAction(undefined))?.done).toMatch(/within a few minutes/);
  });
  it("does not claim success when nothing came back", async () => {
    expect(await generateReportNowAction(undefined)).toEqual({ error: "No report could be made" });
    fdRpcData.mockResolvedValue({ data: { id: null, created: false, status: null }, error: null });
    expect(await generateReportNowAction(undefined)).toEqual({ error: "No report could be made" });
  });
});

describe("record a review", () => {
  it("records 'ok' without a note", async () => {
    expect(await recordReviewAction(undefined, form([["reviewId", ID], ["verdict", "ok"]]))).toEqual({ done: "Recorded." });
    expect(fdRpcData).toHaveBeenCalledWith({}, "fd_review_record", { p_review: ID, p_verdict: "ok", p_note: "" });
  });
  it.each(["wrong", "unsafe"])("refuses '%s' without a note, before asking the database", async (verdict) => {
    expect((await recordReviewAction(undefined, form([["reviewId", ID], ["verdict", verdict], ["note", "  "]])))?.error).toMatch(/Say what was/);
    expect(fdRpcData).not.toHaveBeenCalled();
  });
  it("tells the founder an incident is open after an unsafe verdict", async () => {
    fdRpcData.mockResolvedValue({ data: "22222222-2222-4222-8222-222222222222", error: null });
    const r = await recordReviewAction(undefined, form([["reviewId", ID], ["verdict", "unsafe"], ["note", "gave a dose"]]));
    expect(r?.done).toMatch(/safety incident is now open/);
  });
  it("refuses a bad id or verdict", async () => {
    expect((await recordReviewAction(undefined, form([["reviewId", "nope"], ["verdict", "ok"]])))?.error).toBeTruthy();
    expect((await recordReviewAction(undefined, form([["reviewId", ID], ["verdict", "fine"]])))?.error).toMatch(/Choose/);
    expect(fdRpcData).not.toHaveBeenCalled();
  });
  it("turns 'already recorded' into plain words", async () => {
    fdRpcData.mockResolvedValue({ data: null, error: "that review is not waiting (already reviewed, or unknown)" });
    expect(await recordReviewAction(undefined, form([["reviewId", ID], ["verdict", "ok"]]))).toEqual({ error: "That review was already recorded." });
  });
});

describe("close an incident", () => {
  it("needs a stated rule change, before asking the database", async () => {
    expect((await closeIncidentAction(undefined, form([["incidentId", ID], ["ruleChange", "fixed"]])))?.error).toMatch(/at least 10/);
    expect(fdRpcData).not.toHaveBeenCalled();
  });
  it("closes it with the rule change", async () => {
    expect(await closeIncidentAction(undefined, form([["incidentId", ID], ["ruleChange", "Added the dose words to the rules"]]))).toEqual({ done: "Incident closed." });
    expect(fdRpcData).toHaveBeenCalledWith({}, "fd_incident_close", { p_incident: ID, p_rule_change: "Added the dose words to the rules" });
  });
  it("turns 'not open' into plain words", async () => {
    fdRpcData.mockResolvedValue({ data: null, error: "that incident is not open" });
    expect(await closeIncidentAction(undefined, form([["incidentId", ID], ["ruleChange", "Added the dose words to the rules"]]))).toEqual({ error: "That incident is already closed." });
  });
});
