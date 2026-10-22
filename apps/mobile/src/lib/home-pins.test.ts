/**
 * Home pins on the phone: the saved list is read only for the account being viewed, a failed read is reported
 * (never turned into "show nothing"), a save keeps the pins that must stay on, and the vitals tiles never take
 * a wearable's estimate for pulse, oxygen or temperature.
 */
import { loadPinnedVitalValues, loadStoredHomePins, saveHomePins } from "./home-pins";
import { supabase } from "./supabase";

jest.mock("./supabase", () => ({ supabase: { from: jest.fn() } }));
const mockFrom = supabase.from as unknown as jest.Mock;

type Call = { method: string; args: unknown[] };

/** A chainable query that records each call and resolves to `result` when awaited or when a terminal method is reached. */
function query(result: { data?: unknown; error?: { message: string } | null }, calls: Call[] = []) {
  const settled = Promise.resolve({ data: result.data ?? null, error: result.error ?? null });
  const builder: Record<string, unknown> = {
    then: (resolve: (v: unknown) => unknown, reject?: (e: unknown) => unknown) => settled.then(resolve, reject),
    maybeSingle: () => settled,
  };
  for (const method of ["select", "eq", "neq", "not", "is", "order", "limit", "upsert"]) {
    builder[method] = (...args: unknown[]) => {
      calls.push({ method, args });
      return builder;
    };
  }
  return builder;
}

beforeEach(() => mockFrom.mockReset());

describe("loadStoredHomePins", () => {
  it("returns the saved list in order", async () => {
    mockFrom.mockReturnValue(query({ data: { pinned: ["sleep", "bp"] } }));
    expect(await loadStoredHomePins("p1")).toEqual({ ok: true, data: ["sleep", "bp"] });
  });

  it("returns null when the patient has never customised (or the account is not theirs)", async () => {
    mockFrom.mockReturnValue(query({ data: null }));
    expect(await loadStoredHomePins("p1")).toEqual({ ok: true, data: null });
  });

  it("reports a failed read instead of treating it as an empty list", async () => {
    mockFrom.mockReturnValue(query({ error: { message: "network" } }));
    expect(await loadStoredHomePins("p1")).toEqual({ ok: false, error: "network" });
  });
});

describe("saveHomePins", () => {
  it("upserts the patient's own list for their own id", async () => {
    const calls: Call[] = [];
    mockFrom.mockReturnValue(query({}, calls));
    const result = await saveHomePins("p1", "org-1", ["sleep", "bp"], 0);
    expect(result).toEqual({ ok: true, data: ["sleep", "bp"] });
    expect(calls.find((c) => c.method === "upsert")?.args).toEqual([
      { patient_id: "p1", organisation_id: "org-1", pinned: ["sleep", "bp"] },
      { onConflict: "patient_id" },
    ]);
  });

  it("adds today's doses back for someone on a medication, even if the list left it out", async () => {
    const calls: Call[] = [];
    mockFrom.mockReturnValue(query({}, calls));
    const result = await saveHomePins("p1", "org-1", ["bp"], 3);
    expect(result).toEqual({ ok: true, data: ["bp", "doses_today"] });
    expect((calls.find((c) => c.method === "upsert")?.args[0] as { pinned: string[] }).pinned).toEqual(["bp", "doses_today"]);
  });

  it("drops unknown keys and keeps an empty list as a real choice", async () => {
    mockFrom.mockReturnValue(query({}));
    expect(await saveHomePins("p1", "org-1", ["nonsense" as never], 0)).toEqual({ ok: true, data: [] });
  });

  it("reports a failed save", async () => {
    mockFrom.mockReturnValue(query({ error: { message: "offline" } }));
    expect(await saveHomePins("p1", "org-1", ["bp"], 0)).toEqual({ ok: false, error: "offline" });
  });
});

describe("loadPinnedVitalValues", () => {
  it("asks for nothing when only blood pressure and glucose are pinned (they come from the summary)", async () => {
    expect(await loadPinnedVitalValues("p1", ["bp", "glucose", "sleep"])).toEqual({ ok: true, data: {} });
    expect(mockFrom).not.toHaveBeenCalled();
  });

  it("formats each pinned vital and leaves out one with no reading", async () => {
    mockFrom.mockImplementation(() => query({ data: [{ weight_kg: 71.84 }] }));
    // weight has data, waist's column is absent from the row so it has no usable number
    const result = await loadPinnedVitalValues("p1", ["weight", "waist"]);
    expect(result).toEqual({ ok: true, data: { weight: { value: "71.8", unit: "kg" } } });
  });

  it("skips a superseded or entered-in-error reading", async () => {
    const calls: Call[] = [];
    mockFrom.mockImplementation(() => query({ data: [] }, calls));
    await loadPinnedVitalValues("p1", ["weight"]);
    expect(calls.some((c) => c.method === "is" && c.args[0] === "correction_status" && c.args[1] === null)).toBe(true);
  });

  it("never takes a wearable reading for pulse, but does for weight", async () => {
    const pulseCalls: Call[] = [];
    const weightCalls: Call[] = [];
    mockFrom.mockImplementationOnce(() => query({ data: [] }, pulseCalls)).mockImplementationOnce(() => query({ data: [] }, weightCalls));
    await loadPinnedVitalValues("p1", ["pulse", "weight"]);
    expect(pulseCalls.some((c) => c.method === "neq" && c.args[0] === "source" && c.args[1] === "wearable")).toBe(true);
    expect(weightCalls.some((c) => c.method === "neq")).toBe(false);
  });

  it("reports a failed read", async () => {
    mockFrom.mockImplementation(() => query({ error: { message: "boom" } }));
    expect(await loadPinnedVitalValues("p1", ["weight"])).toEqual({ ok: false, error: "boom" });
  });
});
