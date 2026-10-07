import { describe, expect, it, jest } from "@jest/globals";
import { loadSponsorFigures, type LoadRpc } from "./load-figures";

const ID = "6f1d7a52-0000-4000-8000-000000000001";
const programmes = { sponsor: "Acme", programmes: [{ id: ID, name: "Staff", code: "ABCD2345", valid_from: "2026-01-01", valid_to: "2026-12-31", status: "active", latest_period: null }] };

describe("loadSponsorFigures", () => {
  it("reads each programme's figures, and a failed read of one is null, not empty", async () => {
    const rpc = jest.fn<LoadRpc>().mockResolvedValueOnce({ data: programmes, error: null }).mockResolvedValueOnce({ data: null, error: { message: "x" } });
    const r = await loadSponsorFigures(rpc);
    expect(r).toMatchObject({ ok: true, sponsor: "Acme" });
    expect(r.ok && r.programmes[0].months).toBeNull();
    expect(rpc).toHaveBeenLastCalledWith("sponsor_staff_figures", { p_cohort: ID });
  });
  it("is a failure when the programmes cannot be read", async () => {
    expect(await loadSponsorFigures(jest.fn<LoadRpc>().mockResolvedValue({ data: null, error: { message: "x" } }))).toEqual({ ok: false });
    expect(await loadSponsorFigures(jest.fn<LoadRpc>().mockResolvedValue({ data: { sponsor: 1 }, error: null }))).toEqual({ ok: false });
  });
});
