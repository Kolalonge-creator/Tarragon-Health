/** The annual bundle request PDF lists the real panel's tests, and fails (never prints an empty request) when the panel cannot be read. */
const renderToBuffer = jest.fn(async () => Buffer.from("pdf"));
jest.mock("@react-pdf/renderer", () => ({ renderToBuffer: (...a: unknown[]) => (renderToBuffer as (...x: unknown[]) => unknown)(...a) }));
jest.mock("@/lib/lab-results/lab-request-document", () => ({ LabRequestDocument: ({ data }: { data: unknown }) => data }));
jest.mock("@/lib/clinical/document-folio", () => ({ DocumentFolioRefusedError: class extends Error {}, fetchDocumentFolios: jest.fn() }));

import { generateLabRequestPdf } from "./generate-lab-request-pdf";

type Row = Record<string, unknown> | null;
function client(tables: Record<string, { data: Row; error?: { message: string } | null }>) {
  return {
    from: (t: string) => {
      const r = tables[t] ?? { data: null };
      const chain: Record<string, unknown> = {};
      for (const m of ["select", "eq", "in"]) chain[m] = () => chain;
      chain.maybeSingle = async () => ({ data: r.data, error: r.error ?? null });
      chain.then = (res: (v: unknown) => unknown) => res({ data: Array.isArray(r.data) ? r.data : [], error: null });
      return chain;
    },
  } as never;
}
const order = { id: "o1", order_number: "LO-1", ordered_at: "2026-10-26T10:00:00Z", patient_id: "p1", ordered_by: null, clinical_indication: null, panel_code: "membership_annual", panel_bundle: null };
const patient = { full_name: "Ada", patient_number: "TH-1", date_of_birth: "1980-01-01", sex: "female" };
const analytes = [
  { code: "hba1c", label: "HbA1c" },
  { code: "creatinine", label: "Creatinine" },
  { code: "anti_hbs", label: "Hepatitis B antibody", optional: true },
];

beforeEach(() => {
  renderToBuffer.mockClear();
  jest.spyOn(console, "error").mockImplementation(() => undefined);
});

describe("generateLabRequestPdf for the annual bundle", () => {
  it("lists the active panel's tests, marks optional ones, and titles it the annual bundle", async () => {
    const r = await generateLabRequestPdf(client({ lab_orders: { data: order }, profiles: { data: patient }, lab_panel_versions: { data: { analytes } } }), "o1");
    expect(r.ok).toBe(true);
    const data = (renderToBuffer.mock.calls[0] as unknown[])[0] as { panelName: string; testNames: string[] };
    expect(data.panelName).toBe("Annual health check bundle");
    expect(data.testNames).toEqual(["HbA1c", "Creatinine", "Hepatitis B antibody (only if the doctor asks)"]);
  });

  it("fails instead of printing an empty request when the panel version cannot be read", async () => {
    const r = await generateLabRequestPdf(client({ lab_orders: { data: order }, profiles: { data: patient }, lab_panel_versions: { data: null, error: { message: "boom" } } }), "o1");
    expect(r).toEqual({ ok: false, error: "panel_unavailable" });
    expect(renderToBuffer).not.toHaveBeenCalled();
  });

  it("fails when there is no active panel version at all", async () => {
    const r = await generateLabRequestPdf(client({ lab_orders: { data: order }, profiles: { data: patient }, lab_panel_versions: { data: null } }), "o1");
    expect(r).toEqual({ ok: false, error: "panel_unavailable" });
  });

  it("fails when the version lists no tests", async () => {
    const r = await generateLabRequestPdf(client({ lab_orders: { data: order }, profiles: { data: patient }, lab_panel_versions: { data: { analytes: [] } } }), "o1");
    expect(r).toEqual({ ok: false, error: "panel_unavailable" });
  });

  describe("S98: a sensitive self-service request is not served to a non-owner", () => {
    const sensitiveOrder = { ...order, panel_code: null, origin: "patient_initiated", panel_bundle: { name: "x", description: null, test_codes: ["hiv"] } };
    const tests = { data: [{ code: "hiv", name: "HIV" }] as unknown as Row };
    it("refuses a caregiver as not found", async () => {
      const r = await generateLabRequestPdf(client({ lab_orders: { data: sensitiveOrder }, profiles: { data: patient }, screen_types: { data: [{ code: "hiv" }] as unknown as Row }, lab_tests: tests }), "o1", "caregiver-1");
      expect(r).toEqual({ ok: false, error: "not_found" });
      expect(renderToBuffer).not.toHaveBeenCalled();
    });
    it("serves the owner", async () => {
      const r = await generateLabRequestPdf(client({ lab_orders: { data: sensitiveOrder }, profiles: { data: patient }, screen_types: { data: [{ code: "hiv" }] as unknown as Row }, lab_tests: tests }), "o1", "p1");
      expect(r.ok).toBe(true);
    });
    it("serves a caregiver for a non-sensitive request", async () => {
      const plain = { ...sensitiveOrder, panel_bundle: { name: "x", description: null, test_codes: ["hba1c"] } };
      const r = await generateLabRequestPdf(client({ lab_orders: { data: plain }, profiles: { data: patient }, screen_types: { data: [] as unknown as Row }, lab_tests: tests }), "o1", "caregiver-1");
      expect(r.ok).toBe(true);
    });
  });

  it("a missing order is still simply not found", async () => {
    const r = await generateLabRequestPdf(client({ lab_orders: { data: null } }), "nope");
    expect(r).toEqual({ ok: false, error: "not_found" });
  });
});
