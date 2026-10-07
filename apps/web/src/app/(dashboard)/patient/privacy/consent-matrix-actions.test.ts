/**
 * Consent matrix actions (S42, v5 1.13): the database decides; the action validates its input, calls the patient's own
 * session RPC, and turns the refusal into a sentence.
 */
jest.mock("next/cache", () => ({ revalidatePath: jest.fn() }));

const rpcMock = jest.fn();
jest.mock("@/lib/supabase/server", () => ({
  createClient: jest.fn().mockImplementation(async () => ({ rpc: (...args: unknown[]) => rpcMock(...args) })),
}));

import { applyConsentBundleAction, grantFeatureConsentAction, setConsentCellAction, withdrawAllOptionalConsentsAction } from "./consent-matrix-actions";

beforeEach(() => rpcMock.mockReset().mockResolvedValue({ data: { ok: true }, error: null }));

describe("setConsentCellAction", () => {
  it("calls the RPC with the caller's own session and nothing else", async () => {
    expect(await setConsentCellAction({ dataType: "vitals", purpose: "research", granted: true })).toEqual({ ok: true });
    expect(rpcMock).toHaveBeenCalledWith("set_consent_cell", { p_data_type: "vitals", p_purpose: "research", p_granted: true });
  });

  it("rejects a cell that does not exist without calling the database", async () => {
    expect((await setConsentCellAction({ dataType: "weather", purpose: "research", granted: true }))?.error).toBeTruthy();
    expect((await setConsentCellAction({ dataType: "vitals", purpose: "advertising", granted: true }))?.error).toBeTruthy();
    expect(rpcMock).not.toHaveBeenCalled();
  });

  it("explains the database's refusal to withdraw a needed consent", async () => {
    rpcMock.mockResolvedValue({ data: null, error: { message: "consent_required_for_care" } });
    const result = await setConsentCellAction({ dataType: "vitals", purpose: "care", granted: false });
    expect(result?.error).toMatch(/needed to give you care/i);
  });

  it("reports any other failure instead of pretending it worked", async () => {
    rpcMock.mockResolvedValue({ data: null, error: { message: "boom" } });
    expect((await setConsentCellAction({ dataType: "vitals", purpose: "research", granted: false }))?.error).toMatch(/could not save/i);
  });
});

describe("grantFeatureConsentAction (S47: asked on first use)", () => {
  it("grants only the care cell of one optional-per-use data type, through the person's own session", async () => {
    for (const dataType of ["reproductive", "mental_health", "device_data"]) {
      rpcMock.mockClear();
      expect(await grantFeatureConsentAction({ dataType })).toEqual({ ok: true });
      expect(rpcMock).toHaveBeenCalledWith("set_consent_cell", { p_data_type: dataType, p_purpose: "care", p_granted: true });
    }
  });

  it("refuses a data type that is required for care or does not exist, without calling the database", async () => {
    expect((await grantFeatureConsentAction({ dataType: "vitals" }))?.error).toBeTruthy();
    expect((await grantFeatureConsentAction({ dataType: "documents" }))?.error).toBeTruthy();
    expect((await grantFeatureConsentAction({ dataType: "weather" }))?.error).toBeTruthy();
    expect(rpcMock).not.toHaveBeenCalled();
  });
});

describe("applyConsentBundleAction", () => {
  it("applies a named bundle", async () => {
    expect(await applyConsentBundleAction({ code: "help_research" })).toEqual({ ok: true });
    expect(rpcMock).toHaveBeenCalledWith("apply_consent_bundle", { p_bundle: "help_research" });
  });
  it("refuses a malformed code", async () => {
    expect((await applyConsentBundleAction({ code: "x; drop table" }))?.error).toBeTruthy();
    expect(rpcMock).not.toHaveBeenCalled();
  });
});

describe("withdrawAllOptionalConsentsAction", () => {
  it("takes no input, so it can only ever act on the caller", async () => {
    expect(withdrawAllOptionalConsentsAction.length).toBe(0);
    expect(await withdrawAllOptionalConsentsAction()).toEqual({ ok: true });
    expect(rpcMock).toHaveBeenCalledWith("withdraw_all_optional_consents");
  });
});
