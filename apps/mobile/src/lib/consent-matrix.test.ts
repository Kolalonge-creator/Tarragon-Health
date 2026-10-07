const mockRpc = jest.fn();
jest.mock("./supabase", () => ({ supabase: { rpc: (...a: unknown[]) => mockRpc(...a) } }));

import { applyConsentBundle, loadConsentMatrix, loadConsentMatrixHistory, setConsentCell, withdrawAllOptionalConsents } from "./consent-matrix";

beforeEach(() => mockRpc.mockReset());

const cell = (data_type: string, purpose: string) => ({
  data_type, purpose, required_for_care: purpose === "care", sensitive: false, text_key: `consent.matrix.${data_type}.${purpose}`, wording_status: "draft_pending_counsel", granted: purpose === "care", changed_at: null,
});

describe("consent matrix on the phone", () => {
  it("reads the matrix the database returns", async () => {
    mockRpc.mockResolvedValue({ data: { cells: [cell("vitals", "care")], bundles: [] }, error: null });
    const result = await loadConsentMatrix();
    expect(result.ok && result.data.cells[0]?.required_for_care).toBe(true);
    expect(mockRpc).toHaveBeenCalledWith("my_consent_matrix");
  });

  it("shows an error, never an empty matrix, when the read fails or returns nonsense", async () => {
    mockRpc.mockResolvedValue({ data: null, error: { message: "boom" } });
    expect((await loadConsentMatrix()).ok).toBe(false);
    mockRpc.mockResolvedValue({ data: { cells: "x" }, error: null });
    expect((await loadConsentMatrix()).ok).toBe(false);
  });

  it("sends exactly the cell and the choice", async () => {
    mockRpc.mockResolvedValue({ data: { ok: true }, error: null });
    expect(await setConsentCell("vitals", "research", true)).toEqual({ ok: true, data: null });
    expect(mockRpc).toHaveBeenCalledWith("set_consent_cell", { p_data_type: "vitals", p_purpose: "research", p_granted: true });
  });

  it("explains the database refusal to withdraw a needed consent", async () => {
    mockRpc.mockResolvedValue({ data: null, error: { message: "consent_required_for_care" } });
    const result = await setConsentCell("vitals", "care", false);
    expect(!result.ok && result.error).toMatch(/needed to give you care/i);
  });

  it("applies a bundle and switches off every optional consent", async () => {
    mockRpc.mockResolvedValue({ data: { ok: true }, error: null });
    await applyConsentBundle("help_research");
    expect(mockRpc).toHaveBeenLastCalledWith("apply_consent_bundle", { p_bundle: "help_research" });
    await withdrawAllOptionalConsents();
    expect(mockRpc).toHaveBeenLastCalledWith("withdraw_all_optional_consents");
  });

  it("maps history rows and survives a failed read", async () => {
    mockRpc.mockResolvedValue({ data: [{ data_type: "vitals", purpose: "research", action: "withdrawn", at: "2026-10-06T10:00:00Z" }], error: null });
    expect(await loadConsentMatrixHistory()).toEqual([{ dataType: "vitals", purpose: "research", action: "withdrawn", at: "2026-10-06T10:00:00Z" }]);
    mockRpc.mockResolvedValue({ data: null, error: { message: "x" } });
    expect(await loadConsentMatrixHistory()).toEqual([]);
  });
});
