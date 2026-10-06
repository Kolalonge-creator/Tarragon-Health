const rpc = jest.fn();
const upload = jest.fn();
const remove = jest.fn();
const createSignedUrl = jest.fn();

jest.mock("next/cache", () => ({ revalidatePath: jest.fn() }));
jest.mock("@/lib/supabase/server", () => ({
  createClient: jest.fn().mockResolvedValue({ rpc: (...a: unknown[]) => rpc(...a) }),
  getCurrentUser: jest.fn().mockResolvedValue({ id: "99999999-9999-4999-8999-999999999999" }),
}));
jest.mock("@/lib/supabase/service-role", () => ({
  createServiceRoleClient: () => ({
    storage: { from: () => ({ upload: (...a: unknown[]) => upload(...a), remove: (...a: unknown[]) => remove(...a), createSignedUrl: (...a: unknown[]) => createSignedUrl(...a) }) },
  }),
}));

import { addOwnLabResult, getOwnResultFileUrl, openLabResult, recordDisclosure, releaseResult, submitPartnerResult, withholdResult } from "./structured-actions";

const id = "11111111-1111-4111-8111-111111111111";
const items = JSON.stringify([{ analyte_code: "creatinine", value_numeric: 1.9, unit: "mg/dL" }]);
const pdf = () => new File([new Uint8Array([1, 2, 3])], "report.pdf", { type: "application/pdf" });
const form = (entries: Record<string, string | File>): FormData => {
  const f = new FormData();
  for (const [k, v] of Object.entries(entries)) f.set(k, v);
  return f;
};

beforeEach(() => {
  rpc.mockReset();
  upload.mockReset().mockResolvedValue({ error: null });
  remove.mockReset().mockResolvedValue({ error: null });
  createSignedUrl.mockReset();
});

describe("submitPartnerResult", () => {
  it("sends only analyte, value and unit, with the file metadata, and no flag", async () => {
    rpc.mockImplementation(async (name: string) => (name === "lab_partner_order_patient" ? { data: "88888888-8888-4888-8888-888888888888", error: null } : { data: {}, error: null }));
    const r = await submitPartnerResult(undefined, form({ order_id: id, panel: "essential", items, file: pdf() }));
    expect(r).toEqual({ success: true });
    const call = rpc.mock.calls.find((c) => c[0] === "lab_partner_submit_result");
    expect(call?.[1].p_items).toEqual([{ analyte_code: "creatinine", value_numeric: 1.9, unit: "mg/dL" }]);
    expect(call?.[1].p_file.file_path).toMatch(/^88888888-8888-4888-8888-888888888888\/.+\.pdf$/);
    expect(JSON.stringify(call?.[1])).not.toContain("flag");
  });

  it("removes the stored file when the database refuses the result", async () => {
    rpc.mockImplementation(async (name: string) =>
      name === "lab_partner_order_patient" ? { data: "88888888-8888-4888-8888-888888888888", error: null } : { data: null, error: { message: "lab_unit_mismatch" } },
    );
    const r = await submitPartnerResult(undefined, form({ order_id: id, panel: "essential", items, file: pdf() }));
    expect(r?.error).toMatch(/unit/);
    expect(remove).toHaveBeenCalledTimes(1);
  });

  it("refuses a file type the bucket does not allow before anything is stored", async () => {
    rpc.mockResolvedValue({ data: "88888888-8888-4888-8888-888888888888", error: null });
    const r = await submitPartnerResult(undefined, form({ order_id: id, panel: "essential", items, file: new File(["x"], "a.exe", { type: "application/x-msdownload" }) }));
    expect(r?.error).toMatch(/PDF/);
    expect(upload).not.toHaveBeenCalled();
  });

  it("does not store a file for an order that is not the caller's lab", async () => {
    rpc.mockResolvedValue({ data: null, error: null });
    const r = await submitPartnerResult(undefined, form({ order_id: id, panel: "essential", items, file: pdf() }));
    expect(r?.error).toMatch(/access/);
    expect(upload).not.toHaveBeenCalled();
  });
});

describe("addOwnLabResult", () => {
  it("stores the file under the patient's own folder and calls the patient function", async () => {
    rpc.mockResolvedValue({ data: {}, error: null });
    const r = await addOwnLabResult(undefined, form({ file: pdf() }));
    expect(r).toEqual({ success: true });
    expect(upload.mock.calls[0]![0]).toMatch(/^99999999-9999-4999-8999-999999999999\//);
  });
});

describe("getOwnResultFileUrl", () => {
  it("returns nothing when the database offers no path (a held result)", async () => {
    rpc.mockResolvedValue({ data: null, error: null });
    expect(await getOwnResultFileUrl(id)).toEqual({ error: "Not found." });
    expect(createSignedUrl).not.toHaveBeenCalled();
  });
  it("signs the path the database returned", async () => {
    rpc.mockResolvedValue({ data: "p/x.pdf", error: null });
    createSignedUrl.mockResolvedValue({ data: { signedUrl: "https://signed" } });
    expect(await getOwnResultFileUrl(id)).toEqual({ url: "https://signed" });
  });
});

describe("recordDisclosure", () => {
  it("does not call the database without the attestation", async () => {
    const r = await recordDisclosure(undefined, form({ result_id: id, method: "in_person" }));
    expect(r?.error).toMatch(/told the patient/);
    expect(rpc).not.toHaveBeenCalled();
  });
  it("sends the attestation when ticked", async () => {
    rpc.mockResolvedValue({ data: null, error: null });
    const r = await recordDisclosure(undefined, form({ result_id: id, method: "phone", attested: "on" }));
    expect(r).toEqual({ success: true });
    expect(rpc).toHaveBeenCalledWith("record_lab_disclosure", { p_result: id, p_method: "phone", p_attested: true, p_note: undefined });
  });
});

describe("refusals returned by the database (the denied audit row commits)", () => {
  const refusal = { data: { error: "not_permitted" }, error: null };
  it("release, withhold and disclosure turn a returned refusal into an access message", async () => {
    rpc.mockResolvedValue(refusal);
    expect((await releaseResult(undefined, form({ result_id: id })))?.error).toMatch(/access/);
    expect((await withholdResult(undefined, form({ result_id: id, reason: "Wrong patient" })))?.error).toMatch(/access/);
    expect((await recordDisclosure(undefined, form({ result_id: id, method: "phone", attested: "on" })))?.error).toMatch(/access/);
  });
  it("a critical value refused for a medical officer shows the senior-clinician message", async () => {
    rpc.mockResolvedValue({ data: null, error: { message: "lab_critical_needs_senior_clinician" } });
    expect((await releaseResult(undefined, form({ result_id: id })))?.error).toMatch(/senior/);
  });
});

describe("openLabResult (the audited read happens on a click)", () => {
  it("returns the parsed result", async () => {
    rpc.mockResolvedValue({
      data: { lab_result_id: id, patient_id: id, release_state: "awaiting_review", release_reason: "abnormal", panel_code: "essential", received_at: "2026-10-06T10:00:00Z", submitted_by_kind: "partner", file_path: null, items: [] },
      error: null,
    });
    const r = await openLabResult(id);
    expect(r.result?.release_reason).toBe("abnormal");
    expect(rpc).toHaveBeenCalledWith("lab_result_for_review", expect.objectContaining({ p_result: id }));
  });
  it("shows nothing for a refusal", async () => {
    rpc.mockResolvedValue({ data: { error: "not_permitted" }, error: null });
    const r = await openLabResult(id);
    expect(r.result).toBeUndefined();
    expect(r.error).toMatch(/access/);
  });
});
