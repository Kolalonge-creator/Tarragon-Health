/**
 * S24 mobile: the three RPC calls, the offline rule (a medicine change is never applied from a queue, so an
 * offline answer is a plain message and nothing is stored), and the neutral bell line.
 */
import { supabase } from "./supabase";
import { confirmCareChange, declineCareChange, isOfflineError, loadCareChanges } from "./care-changes";
import { describeNotification } from "./notifications";

jest.mock("./supabase", () => ({ supabase: { rpc: jest.fn(), from: jest.fn() } }));

const rpc = supabase.rpc as unknown as jest.Mock;
const ID = "0b8f6d0e-3c1a-4f3e-9a52-1d6f6a9f7c11";

beforeEach(() => rpc.mockReset());

describe("isOfflineError", () => {
  it("recognises a request that never reached the server", () => {
    expect(isOfflineError({ message: "Network request failed" })).toBe(true);
    expect(isOfflineError({ message: "TypeError: Failed to fetch" })).toBe(true);
    expect(isOfflineError({ message: "x", status: 0 })).toBe(true);
  });
  it("does not treat a server refusal as offline", () => {
    expect(isOfflineError({ message: "This change is no longer waiting for your answer", status: 400 })).toBe(false);
    expect(isOfflineError(null)).toBe(false);
  });
});

describe("loadCareChanges", () => {
  it("parses rows and drops bad ones", async () => {
    rpc.mockResolvedValue({ data: [{ id: ID, kind: "medication", state: "signed", proposal: { action: "stop" } }, { id: "x" }], error: null });
    const r = await loadCareChanges();
    expect(rpc).toHaveBeenCalledWith("my_care_plan_changes");
    expect(r.ok && r.changes).toHaveLength(1);
  });
  it("a failed read is reported, not an empty list", async () => {
    rpc.mockResolvedValue({ data: null, error: { message: "Network request failed" } });
    expect(await loadCareChanges()).toEqual({ ok: false, offline: true });
  });
});

describe("confirmCareChange", () => {
  it("applied, expired, needs_review, not_available pass through", async () => {
    for (const outcome of ["applied", "expired", "needs_review", "not_available"] as const) {
      rpc.mockResolvedValueOnce({ data: { outcome }, error: null });
      expect(await confirmCareChange(ID)).toEqual({ ok: true, outcome });
    }
    expect(rpc).toHaveBeenCalledWith("confirm_care_plan_change", { p_change: ID });
  });
  it("offline shows the connection message and does not retry or queue", async () => {
    rpc.mockResolvedValue({ data: null, error: { message: "Network request failed" } });
    expect(await confirmCareChange(ID)).toEqual({ ok: false, key: "careChange.offline" });
    expect(rpc).toHaveBeenCalledTimes(1);
  });
  it("a server error or unreadable reply is never applied", async () => {
    rpc.mockResolvedValueOnce({ data: null, error: { message: "boom" } });
    expect(await confirmCareChange(ID)).toEqual({ ok: false, key: "careChange.outcome.error" });
    rpc.mockResolvedValueOnce({ data: { outcome: "??" }, error: null });
    expect(await confirmCareChange(ID)).toEqual({ ok: false, key: "careChange.outcome.error" });
    expect(await confirmCareChange("")).toEqual({ ok: false, key: "careChange.outcome.error" });
  });
});

describe("declineCareChange", () => {
  it("says the care team has been told", async () => {
    rpc.mockResolvedValue({ data: null, error: null });
    expect(await declineCareChange(ID)).toEqual({ ok: true, key: "careChange.outcome.declined" });
    expect(rpc).toHaveBeenCalledWith("decline_care_plan_change", { p_change: ID });
  });
  it("offline and error", async () => {
    rpc.mockResolvedValueOnce({ data: null, error: { message: "Network request failed" } });
    expect(await declineCareChange(ID)).toEqual({ ok: false, key: "careChange.offline" });
    rpc.mockResolvedValueOnce({ data: null, error: { message: "boom" } });
    expect(await declineCareChange(ID)).toEqual({ ok: false, key: "careChange.outcome.error" });
  });
});

describe("bell line", () => {
  it("is neutral and opens Medicines", () => {
    expect(
      describeNotification({ id: "n", status: "unread", template: "care_change_ready_patient", payload: { care_plan_change_id: "x", drug_name: "secret" }, createdAt: "" }),
    ).toEqual({ text: "Your care team has a change for you", section: "medications" });
  });
});
