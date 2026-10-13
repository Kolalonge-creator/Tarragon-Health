jest.mock("./supabase", () => ({ supabase: { rpc: jest.fn() } }));

import { supabase } from "./supabase";
import { joinProgramme, leaveProgramme, loadMemberships, parseMemberships, setSharing } from "./programmes";

const rpc = supabase.rpc as unknown as jest.Mock;
const row = { cohort_id: "c1", name: "Staff", sponsor: "Acme", joined_at: "2026-10-01", reporting_consent: false, consent_available: true };
beforeEach(() => rpc.mockReset());

describe("memberships", () => {
  it("parses the rows and keeps sharing off unless the database says on", () => {
    expect(parseMemberships([row])).toEqual([{ cohortId: "c1", name: "Staff", sponsor: "Acme", joinedAt: "2026-10-01", sharing: false, sharingOpen: true }]);
  });
  it("rejects a malformed row instead of guessing", () => {
    expect(parseMemberships([{ ...row, reporting_consent: "yes" }])).toBeNull();
    expect(parseMemberships({})).toBeNull();
  });
  it("reports a failed read as a failure, not as no programmes", async () => {
    rpc.mockResolvedValueOnce({ data: null, error: { message: "x" } });
    expect(await loadMemberships()).toEqual({ ok: false });
    rpc.mockRejectedValueOnce(new Error("offline"));
    expect(await loadMemberships()).toEqual({ ok: false });
  });
});

describe("joinProgramme", () => {
  it("does not call the database for a code of the wrong length", async () => {
    expect(await joinProgramme("ab")).toBe("code_invalid");
    expect(rpc).not.toHaveBeenCalled();
  });
  it("words each answer", async () => {
    rpc.mockResolvedValueOnce({ data: { ok: true, status: "joined" }, error: null });
    expect(await joinProgramme(" abcd-2345 ")).toBe("joined");
    expect(rpc).toHaveBeenCalledWith("join_cohort", { p_code: "abcd-2345" });
    rpc.mockResolvedValueOnce({ data: { ok: true, status: "already" }, error: null });
    expect(await joinProgramme("ABCD2345")).toBe("already");
    rpc.mockResolvedValueOnce({ data: { ok: false }, error: null });
    expect(await joinProgramme("ABCD2345")).toBe("code_invalid");
  });
  it("a failed call is an error, never success", async () => {
    rpc.mockResolvedValueOnce({ data: null, error: { message: "x" } });
    expect(await joinProgramme("ABCD2345")).toBe("error");
    rpc.mockRejectedValueOnce(new Error("offline"));
    expect(await joinProgramme("ABCD2345")).toBe("error");
  });
});

describe("sharing and leaving", () => {
  it("saved, unavailable while the text is not in force, and error", async () => {
    rpc.mockResolvedValueOnce({ data: { ok: true, reporting_consent: true }, error: null });
    expect(await setSharing("c1", true)).toBe("saved");
    rpc.mockResolvedValueOnce({ data: { ok: false, reason: "not_available" }, error: null });
    expect(await setSharing("c1", true)).toBe("unavailable");
    rpc.mockResolvedValueOnce({ data: { ok: false }, error: null });
    expect(await setSharing("c1", true)).toBe("error");
    rpc.mockResolvedValueOnce({ data: null, error: { message: "x" } });
    expect(await setSharing("c1", false)).toBe("error");
  });
  it("leaving is saved only when the database says ok", async () => {
    rpc.mockResolvedValueOnce({ data: { ok: true }, error: null });
    expect(await leaveProgramme("c1")).toBe("saved");
    rpc.mockResolvedValueOnce({ data: { ok: false }, error: null });
    expect(await leaveProgramme("c1")).toBe("error");
  });
});
