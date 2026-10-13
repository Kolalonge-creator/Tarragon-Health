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

import { addOwnLabResult, getOwnResultFileUrl, openLabResult, recordDisclosure, listReleasedLabResults, recordDisclosureAttempt, releaseResult, submitPartnerCorrection, submitPartnerResult, submitTeamResult, withdrawResult, withholdResult } from "./structured-actions";

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
    const r = await submitPartnerResult(undefined, form({ order_id: id, panel: "membership_annual", items, file: pdf() }));
    expect(r).toEqual({ success: true });
    const call = rpc.mock.calls.find((c) => c[0] === "lab_partner_submit_result");
    expect(call?.[1].p_items).toEqual([{ analyte_code: "creatinine", value_numeric: 1.9, unit: "mg/dL" }]);
    expect(call?.[1].p_file.file_path).toMatch(/^88888888-8888-4888-8888-888888888888\/.+\.pdf$/);
    expect(JSON.stringify(call?.[1])).not.toContain("flag");
  });

  it("converts a value the lab printed in another known unit before it reaches the database", async () => {
    rpc.mockImplementation(async () => ({ data: {}, error: null }));
    const mmol = JSON.stringify([
      { analyte_code: "fasting_glucose", value_numeric: 5.2, unit: "mmol/L" },
      { analyte_code: "creatinine", value_numeric: 106, unit: "µmol/L" },
      { analyte_code: "haemoglobin", value_numeric: 125, unit: "g/L" },
      { analyte_code: "alt", value_numeric: 24 },
    ]);
    const r = await submitPartnerResult(undefined, form({ order_id: id, panel: "membership_annual", items: mmol }));
    expect(r).toEqual({ success: true });
    const call = rpc.mock.calls.find((c) => c[0] === "lab_partner_submit_result");
    expect(call?.[1].p_items).toEqual([
      { analyte_code: "fasting_glucose", value_numeric: 94, unit: "mg/dL" },
      { analyte_code: "creatinine", value_numeric: 1.2, unit: "mg/dL" },
      { analyte_code: "haemoglobin", value_numeric: 12.5, unit: "g/dL" },
      { analyte_code: "alt", value_numeric: 24, unit: "U/L" },
    ]);
  });

  it("refuses a unit nobody knows with a plain message and sends nothing", async () => {
    rpc.mockResolvedValue({ data: {}, error: null });
    const bad = JSON.stringify([{ analyte_code: "creatinine", value_numeric: 1, unit: "stones" }]);
    const r = await submitPartnerResult(undefined, form({ order_id: id, panel: "membership_annual", items: bad }));
    expect(r?.error).toMatch(/unit/i);
    expect(rpc).not.toHaveBeenCalled();
  });

  it("leaves an analyte it does not know for the database to judge", async () => {
    rpc.mockImplementation(async () => ({ data: {}, error: null }));
    const odd = JSON.stringify([{ analyte_code: "made_up", value_numeric: 1, unit: "mg/dL" }]);
    await submitPartnerResult(undefined, form({ order_id: id, panel: "membership_annual", items: odd }));
    expect(rpc.mock.calls.find((c) => c[0] === "lab_partner_submit_result")?.[1].p_items).toEqual([{ analyte_code: "made_up", value_numeric: 1, unit: "mg/dL" }]);
  });

  it("removes the stored file when the database refuses the result", async () => {
    rpc.mockImplementation(async (name: string) =>
      name === "lab_partner_order_patient" ? { data: "88888888-8888-4888-8888-888888888888", error: null } : { data: null, error: { message: "lab_unit_mismatch" } },
    );
    const r = await submitPartnerResult(undefined, form({ order_id: id, panel: "membership_annual", items, file: pdf() }));
    expect(r?.error).toMatch(/unit/);
    expect(remove).toHaveBeenCalledTimes(1);
  });

  it("refuses a file type the bucket does not allow before anything is stored", async () => {
    rpc.mockResolvedValue({ data: "88888888-8888-4888-8888-888888888888", error: null });
    const r = await submitPartnerResult(undefined, form({ order_id: id, panel: "membership_annual", items, file: new File(["x"], "a.exe", { type: "application/x-msdownload" }) }));
    expect(r?.error).toMatch(/PDF/);
    expect(upload).not.toHaveBeenCalled();
  });

  it("does not store a file for an order that is not the caller's lab", async () => {
    rpc.mockResolvedValue({ data: null, error: null });
    const r = await submitPartnerResult(undefined, form({ order_id: id, panel: "membership_annual", items, file: pdf() }));
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
      data: { lab_result_id: id, patient_id: id, release_state: "awaiting_review", release_reason: "abnormal", panel_code: "membership_annual", received_at: "2026-10-06T10:00:00Z", submitted_by_kind: "partner", file_path: null, items: [] },
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

describe("S27d: disclosure attempts, withdrawal, corrections and the staff path", () => {
  it("logs an attempt with a known outcome and turns a returned refusal into an access message", async () => {
    rpc.mockResolvedValue({ data: { ok: true, attempts: 1, escalated: false }, error: null });
    expect(await recordDisclosureAttempt(undefined, form({ result_id: id, outcome: "no_answer" }))).toEqual({ success: true });
    expect(rpc).toHaveBeenCalledWith("record_lab_disclosure_attempt", { p_result: id, p_outcome: "no_answer", p_note: undefined });
    rpc.mockResolvedValue({ data: { error: "not_permitted" }, error: null });
    expect((await recordDisclosureAttempt(undefined, form({ result_id: id, outcome: "no_answer" })))?.error).toMatch(/access/);
    expect((await recordDisclosureAttempt(undefined, form({ result_id: id, outcome: "made_up" })))?.error).toBeDefined();
  });

  it("withdraws a released result only with a reason", async () => {
    expect((await withdrawResult(undefined, form({ result_id: id, reason: " " })))?.error).toBeDefined();
    rpc.mockResolvedValue({ data: { ok: true }, error: null });
    expect(await withdrawResult(undefined, form({ result_id: id, reason: "Wrong patient" }))).toEqual({ success: true });
  });

  it("sends a correction with its kind and reason and cleans up the file if the database refuses", async () => {
    rpc.mockImplementation(async (name: string) =>
      name === "lab_partner_order_patient" ? { data: "88888888-8888-4888-8888-888888888888", error: null } : { data: null, error: { message: "lab_correction_target_invalid" } },
    );
    const r = await submitPartnerCorrection(undefined, form({ order_id: id, panel: "membership_annual", items, corrects_result_id: id, kind: "corrected", reason: "Keyed wrongly", file: pdf() }));
    expect(r?.error).toMatch(/cannot be sent/);
    expect(remove).toHaveBeenCalledTimes(1);
    const call = rpc.mock.calls.find((c) => c[0] === "lab_partner_submit_correction");
    expect(call?.[1]).toMatchObject({ p_corrects: id, p_kind: "corrected", p_reason: "Keyed wrongly" });
  });

  it("refuses a correction without a reason before calling the database", async () => {
    const r = await submitPartnerCorrection(undefined, form({ order_id: id, panel: "membership_annual", items, corrects_result_id: id, kind: "corrected", reason: "" }));
    expect(r?.error).toMatch(/what changed/i);
    expect(rpc).not.toHaveBeenCalled();
  });

  it("records a staff-supplied file as a HELD result through the care-team function, and removes the file on refusal", async () => {
    rpc.mockResolvedValue({ data: {}, error: null });
    expect(await submitTeamResult("99999999-9999-4999-8999-999999999999", undefined, pdf())).toEqual({ success: true });
    expect(rpc).toHaveBeenCalledWith("team_submit_lab_result", expect.objectContaining({ p_patient: "99999999-9999-4999-8999-999999999999", p_items: null }));
    rpc.mockResolvedValue({ data: null, error: { message: "Not permitted" } });
    expect((await submitTeamResult("99999999-9999-4999-8999-999999999999", undefined, pdf()))?.error).toMatch(/access/);
    expect(remove).toHaveBeenCalled();
  });
});

describe("S27f: the released-results list for withdrawal", () => {
  const row = { lab_result_id: id, received_at: "2026-10-06T10:00:00Z", released_at: "2026-10-06T11:00:00Z", panel_code: "membership_annual", order_number: "LO-1", submitted_by_kind: "partner", withdrawn: false, replaced: false, abnormal_count: 1, item_count: 10 };
  it("returns the parsed rows for a senior tied clinician", async () => {
    rpc.mockResolvedValue({ data: { results: [row] }, error: null });
    const r = await listReleasedLabResults("99999999-9999-4999-8999-999999999999");
    expect(r.results?.[0]?.abnormal_count).toBe(1);
    expect(rpc).toHaveBeenCalledWith("patient_released_lab_results", expect.objectContaining({ p_patient: "99999999-9999-4999-8999-999999999999" }));
  });
  it("turns the senior-only and not-permitted answers into plain messages and shows nothing", async () => {
    rpc.mockResolvedValue({ data: { error: "senior_only" }, error: null });
    expect((await listReleasedLabResults("99999999-9999-4999-8999-999999999999")).error).toMatch(/senior/);
    rpc.mockResolvedValue({ data: { error: "not_permitted" }, error: null });
    const r = await listReleasedLabResults("99999999-9999-4999-8999-999999999999");
    expect(r.results).toBeUndefined();
    expect(r.error).toMatch(/access/);
  });
  it("never calls the database for a malformed patient id", async () => {
    expect((await listReleasedLabResults("nope")).error).toBeDefined();
    expect(rpc).not.toHaveBeenCalled();
  });
  it("a replaced result gives the plain reason when someone tries to release it", async () => {
    rpc.mockResolvedValue({ data: null, error: { message: "lab_result_replaced" } });
    expect((await releaseResult(undefined, form({ result_id: id })))?.error).toMatch(/replaced by a corrected/);
  });
});
