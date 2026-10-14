import { ApiLabResultsSource, getLabResultsSource, ManualEntryLabResultsSource, refusalFromError, type RpcClient } from "./results-source";

const ORDER = "11111111-1111-4111-8111-111111111111";
const items = [{ analyte_code: "fasting_glucose", value_numeric: 88, unit: "mg/dL" }];
const client = (result: { data: unknown; error: { message: string; code?: string } | null }) => {
  const rpc = jest.fn(async (..._a: unknown[]) => result);
  return { rpc, c: { rpc } as unknown as RpcClient };
};

describe("ManualEntryLabResultsSource", () => {
  it("hands values to the one database door and reports the held state", async () => {
    const { rpc, c } = client({ data: { lab_result_id: "22222222-2222-4222-8222-222222222222", release_state: "awaiting_review" }, error: null });
    const out = await new ManualEntryLabResultsSource(c).submit({ orderId: ORDER, panel: "membership_annual", items });
    expect(out).toEqual({ ok: true, labResultId: "22222222-2222-4222-8222-222222222222", releaseState: "awaiting_review" });
    expect(rpc).toHaveBeenCalledTimes(1);
    expect(rpc.mock.calls[0]?.[0]).toBe("lab_partner_submit_result");
  });

  it("never calls the database with a malformed order id", async () => {
    const { rpc, c } = client({ data: null, error: null });
    const out = await new ManualEntryLabResultsSource(c).submit({ orderId: "nope", panel: "membership_annual", items });
    expect(out.ok).toBe(false);
    expect(out.ok === false && out.reason).toBe("invalid_input");
    expect(rpc).not.toHaveBeenCalled();
  });

  it("another laboratory's order is refused with the database's own message and reported as such", async () => {
    const { c } = client({ data: null, error: { message: "Order not found for this lab", code: "42501" } });
    const out = await new ManualEntryLabResultsSource(c).submit({ orderId: ORDER, panel: "membership_annual", items });
    expect(out).toMatchObject({ ok: false, reason: "not_this_labs_order" });
  });

  it("a second result for the same order is reported as already received", () => {
    expect(refusalFromError({ message: "lab_result_already_received" }).reason).toBe("already_received");
  });

  it("any other failure is a plain failure, not a success", async () => {
    const { c } = client({ data: null, error: { message: "boom" } });
    const out = await new ManualEntryLabResultsSource(c).submit({ orderId: ORDER, panel: "membership_annual", items });
    expect(out).toMatchObject({ ok: false, reason: "failed" });
  });
});

describe("ApiLabResultsSource (a stub)", () => {
  it("is never configured and never reaches the network or the database", async () => {
    const api = new ApiLabResultsSource({ baseUrl: "https://lab.example.invalid", credentialRef: "x" });
    expect(api.isConfigured()).toBe(false);
    expect(api.databaseSource).toBe("api");
    expect(await api.submit()).toMatchObject({ ok: false, reason: "not_connected" });
  });
  it("the factory returns the stub for api and the manual source otherwise", () => {
    const { c } = client({ data: null, error: null });
    expect(getLabResultsSource("api", c).kind).toBe("api");
    expect(getLabResultsSource("manual_entry", c).kind).toBe("manual_entry");
  });
});
