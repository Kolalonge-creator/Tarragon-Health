const mockRpc = jest.fn();
jest.mock("./supabase", () => ({ supabase: { rpc: (...a: unknown[]) => mockRpc(...a) } }));

import { grantFeatureConsent, isFeatureConsentRefusal, loadFeatureConsentOn } from "./feature-consent";

beforeEach(() => mockRpc.mockReset());

describe("feature consent on the phone (S47d)", () => {
  it("is on only when the database says so", async () => {
    mockRpc.mockResolvedValue({ data: { on: true }, error: null });
    expect(await loadFeatureConsentOn("reproductive")).toBe(true);
    expect(mockRpc).toHaveBeenCalledWith("feature_consent_state", { p_data_type: "reproductive" });
    mockRpc.mockResolvedValue({ data: { on: false }, error: null });
    expect(await loadFeatureConsentOn("mental_health")).toBe(false);
  });

  it("fails closed: an error or a malformed answer is no", async () => {
    mockRpc.mockResolvedValue({ data: null, error: { message: "down" } });
    expect(await loadFeatureConsentOn("device_data")).toBe(false);
    mockRpc.mockResolvedValue({ data: { on: "true" }, error: null });
    expect(await loadFeatureConsentOn("device_data")).toBe(false);
    mockRpc.mockResolvedValue({ data: null, error: null });
    expect(await loadFeatureConsentOn("device_data")).toBe(false);
  });

  it("the yes grants only the care cell of that one data type", async () => {
    mockRpc.mockResolvedValue({ data: { ok: true }, error: null });
    expect(await grantFeatureConsent("device_data")).toEqual({ ok: true });
    expect(mockRpc).toHaveBeenCalledWith("set_consent_cell", { p_data_type: "device_data", p_purpose: "care", p_granted: true });
  });

  it("recognises the database refusal", () => {
    expect(isFeatureConsentRefusal("consent_required:mental_health")).toBe(true);
    expect(isFeatureConsentRefusal("something else")).toBe(false);
    expect(isFeatureConsentRefusal(undefined)).toBe(false);
  });
});
