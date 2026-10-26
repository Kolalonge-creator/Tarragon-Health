import { parseRenewal } from "./parse";

const mockInvoke = jest.fn();
const mockRpc = jest.fn();
jest.mock("../supabase", () => ({ supabase: { functions: { invoke: (...a: unknown[]) => mockInvoke(...a) }, rpc: (...a: unknown[]) => mockRpc(...a) } }));
import { cancelRenewal, loadAutoRenewEnabled, loadMyRenewal, startCheckout } from "./api";

const OK = { data: { reference: "tho_x", checkout_url: "https://checkout.paystack.com/a" }, error: null };

describe("mobile automatic renewal", () => {
  beforeEach(() => { mockInvoke.mockReset(); mockRpc.mockReset(); });

  it("sends the person's tick as auto_renew, and only when they gave it", async () => {
    mockInvoke.mockResolvedValue(OK);
    await startCheckout("membership_annual", "k1", undefined, { autoRenew: true });
    expect(mockInvoke).toHaveBeenLastCalledWith("order-checkout", { body: { code: "membership_annual", client_key: "k1", auto_renew: true } });
    await startCheckout("membership_annual", "k2", undefined, { autoRenew: false });
    expect(mockInvoke).toHaveBeenLastCalledWith("order-checkout", { body: { code: "membership_annual", client_key: "k2" } });
    await startCheckout("membership_annual", "k3");
    expect(mockInvoke).toHaveBeenLastCalledWith("order-checkout", { body: { code: "membership_annual", client_key: "k3" } });
  });

  it("reads the renewal switch as ON only when the database says exactly true; any failure is OFF", async () => {
    mockRpc.mockResolvedValue({ data: true, error: null });
    expect(await loadAutoRenewEnabled()).toBe(true);
    mockRpc.mockResolvedValue({ data: false, error: null });
    expect(await loadAutoRenewEnabled()).toBe(false);
    mockRpc.mockResolvedValue({ data: "true", error: null });
    expect(await loadAutoRenewEnabled()).toBe(false);
    mockRpc.mockResolvedValue({ data: true, error: { message: "function does not exist" } });
    expect(await loadAutoRenewEnabled()).toBe(false);
  });

  it("parses the status, keeps only the last four digits of the card, and treats a strange reply as no information", () => {
    const full = { enabled: true, has_membership: true, auto_renew: true, ends_at: "2027-10-26T00:00:00Z", amount_kobo: 12_900_000, card: { brand: "visa", last4: "4081", exp_month: "12", exp_year: "2030", authorization_code: "AUTH_secret" } };
    expect(parseRenewal(full)).toEqual({ enabled: true, hasMembership: true, autoRenew: true, endsAt: "2027-10-26T00:00:00Z", amountKobo: 12_900_000, cardLast4: "4081" });
    expect(JSON.stringify(parseRenewal(full))).not.toMatch(/AUTH_/);
    expect(parseRenewal({ enabled: true, has_membership: false })).toEqual({ enabled: true, hasMembership: false, autoRenew: false, endsAt: null, amountKobo: null, cardLast4: null });
    expect(parseRenewal({ enabled: true, has_membership: true, amount_kobo: -5, card: "x" })).toMatchObject({ amountKobo: null, cardLast4: null });
    expect(parseRenewal(null)).toBeNull();
    expect(parseRenewal({ enabled: "yes", has_membership: true })).toBeNull();
    expect(parseRenewal("what")).toBeNull();
  });

  it("loads the status and reports a database error as a failure, never a guess", async () => {
    mockRpc.mockResolvedValue({ data: { enabled: true, has_membership: true, auto_renew: false }, error: null });
    expect(await loadMyRenewal()).toMatchObject({ ok: true, data: { autoRenew: false } });
    mockRpc.mockResolvedValue({ data: null, error: { message: "boom" } });
    expect(await loadMyRenewal()).toEqual({ ok: false, error: "boom" });
  });

  it("cancelling reports success or failure", async () => {
    mockRpc.mockResolvedValue({ data: { result: "cancelled" }, error: null });
    expect(await cancelRenewal()).toBe(true);
    expect(mockRpc).toHaveBeenLastCalledWith("cancel_membership_renewal");
    mockRpc.mockResolvedValue({ data: null, error: { message: "boom" } });
    expect(await cancelRenewal()).toBe(false);
  });
});
