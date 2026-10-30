import { isPossiblyPregnant, pregnancyForPrescribing, PREGNANCY_UNKNOWN_MESSAGE, readPregnancySafety, type PregnancyRpcClient } from "./pregnancy-status";

function client(result: { data: unknown; error: { message?: string; code?: string } | null } | Error): PregnancyRpcClient & { calls: unknown[] } {
  const calls: unknown[] = [];
  return {
    calls,
    rpc: (fn, args) => {
      calls.push([fn, args]);
      return result instanceof Error ? Promise.reject(result) : Promise.resolve(result);
    },
  };
}

describe("readPregnancySafety (OQ-555 follow-up)", () => {
  let errorSpy: jest.SpyInstance;
  beforeEach(() => {
    errorSpy = jest.spyOn(console, "error").mockImplementation(() => undefined);
  });
  afterEach(() => errorSpy.mockRestore());

  it("asks the database's three-state function with the patient only", async () => {
    const c = client({ data: { pregnancy: "pregnant", has_record: true, last_delivery_date: null }, error: null });
    expect(await readPregnancySafety(c, "p1")).toEqual({ status: "pregnant", hasRecord: true, lastDeliveryDate: null });
    expect(c.calls).toEqual([["pregnancy_safety_status", { p_patient: "p1" }]]);
  });

  it("a readable 'not pregnant' stays 'not pregnant', with its record flag and delivery date", async () => {
    const r = await readPregnancySafety(client({ data: { pregnancy: "not_pregnant", has_record: false, last_delivery_date: "2026-01-01" }, error: null }), "p1");
    expect(r).toEqual({ status: "not_pregnant", hasRecord: false, lastDeliveryDate: "2026-01-01" });
  });

  it("the database's own 'unknown' stays unknown", async () => {
    expect((await readPregnancySafety(client({ data: { pregnancy: "unknown", has_record: false, last_delivery_date: null }, error: null }), "p1")).status).toBe("unknown");
  });

  it.each([
    ["an error", { data: null, error: { message: "boom" } }],
    ["no data", { data: null, error: null }],
    ["a malformed reply", { data: { pregnancy: "maybe" }, error: null }],
    ["a reply with the wrong shape", { data: { pregnancy: "pregnant" }, error: null }],
    ["a thrown call", new Error("network")],
  ])("%s is unknown, never 'not pregnant'", async (_label, result) => {
    expect(await readPregnancySafety(client(result), "p1")).toEqual({ status: "unknown", hasRecord: false, lastDeliveryDate: null });
    // a failure is logged, so an outage does not pass for a legitimate "not tied" answer
    expect(errorSpy).toHaveBeenCalled();
  });

  it("the database's own 'unknown' (a legitimate refusal) is not logged as a failure", async () => {
    await readPregnancySafety(client({ data: { pregnancy: "unknown", has_record: false, last_delivery_date: null }, error: null }), "p1");
    expect(errorSpy).not.toHaveBeenCalled();
  });

  it("only a clear 'not pregnant' is not possibly pregnant", () => {
    expect(isPossiblyPregnant("not_pregnant")).toBe(false);
    expect(isPossiblyPregnant("pregnant")).toBe(true);
    expect(isPossiblyPregnant("unknown")).toBe(true);
  });

  it("the prescribing form gets the cautious flag, and is told to show the message only when unknown", () => {
    expect(pregnancyForPrescribing("not_pregnant")).toEqual({ pregnant: false, unknown: false });
    expect(pregnancyForPrescribing("pregnant")).toEqual({ pregnant: true, unknown: false });
    expect(pregnancyForPrescribing("unknown")).toEqual({ pregnant: true, unknown: true });
  });

  it("the message is the one the prescriber is told", () => {
    expect(PREGNANCY_UNKNOWN_MESSAGE).toBe("Pregnancy status could not be read. Check before prescribing.");
  });
});
