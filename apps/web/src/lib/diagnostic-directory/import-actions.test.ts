const rpc = jest.fn();
const redirect = jest.fn((url: string) => {
  throw new Error(`REDIRECT:${url}`);
});
jest.mock("next/navigation", () => ({ redirect: (u: string) => redirect(u) }));
jest.mock("@/lib/supabase/server", () => ({ createClient: async () => ({ rpc }) }));

import { applyImportRowAction, rejectImportRowAction, stageImportAction } from "./import-actions";

const B = "11111111-1111-4111-8111-111111111111";
const R = "22222222-2222-4222-8222-222222222222";
const BASE = "REDIRECT:/admin/ops/diagnostic-directory/import";
const goes = async (p: Promise<void>) => p.then(() => "no redirect", (e: Error) => e.message);
const csv = "trading_name,branch_name,facility_type,state,town,address,evidence\nLab,Lekki,lab,Lagos,Lekki,1 Road Lekki,MLSCN list\n";
const form = (o: Record<string, string | Blob>) => {
  const f = new FormData();
  Object.entries(o).forEach(([k, v]) => f.set(k, v));
  return f;
};

beforeEach(() => { rpc.mockReset(); redirect.mockClear(); });

describe("stageImportAction", () => {
  it("sends the parsed rows and opens the batch", async () => {
    rpc.mockResolvedValue({ data: B, error: null });
    expect(await goes(stageImportAction(form({ source: "Lagos labs sheet", file: new Blob([csv]) })))).toBe(`${BASE}?batch=${B}&n=import_staged`);
    expect(rpc).toHaveBeenCalledWith("admin_dx_import_stage", expect.objectContaining({
      p_source: "Lagos labs sheet", p_rows: [expect.objectContaining({ trading_name: "Lab", address: "1 Road Lekki" })],
    }));
  });
  it("refuses a file without the required columns before calling the database", async () => {
    expect(await goes(stageImportAction(form({ source: "Lagos labs sheet", file: new Blob(["a,b\n1,2\n"]) })))).toBe(`${BASE}?n=import_bad_file`);
    expect(rpc).not.toHaveBeenCalled();
  });
  it("refuses a missing file", async () => {
    expect(await goes(stageImportAction(form({ source: "Lagos labs sheet" })))).toBe(`${BASE}?n=import_bad_file`);
  });
});

describe("applyImportRowAction", () => {
  it("reports a duplicate branch distinctly", async () => {
    rpc.mockResolvedValue({ data: null, error: { code: "23505" } });
    expect(await goes(applyImportRowAction(form({ batch_id: B, row_id: R })))).toBe(`${BASE}?batch=${B}&n=import_duplicate`);
  });
  it("a contracted provider is reported as such", async () => {
    rpc.mockResolvedValue({ data: null, error: { code: "42501" } });
    expect(await goes(applyImportRowAction(form({ batch_id: B, row_id: R })))).toBe(`${BASE}?batch=${B}&n=contracted_branch`);
  });
});

describe("rejectImportRowAction", () => {
  it("needs a reason of at least 10 characters", async () => {
    expect(await goes(rejectImportRowAction(form({ batch_id: B, row_id: R, reason: "no" })))).toBe(`${BASE}?batch=${B}&n=invalid`);
    expect(rpc).not.toHaveBeenCalled();
  });
});
