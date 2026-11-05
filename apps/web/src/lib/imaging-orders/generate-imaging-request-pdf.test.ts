const renderToBuffer = jest.fn(async () => Buffer.from("pdf"));
jest.mock("@react-pdf/renderer", () => ({ renderToBuffer: (...a: unknown[]) => (renderToBuffer as (...x: unknown[]) => unknown)(...a) }));
jest.mock("./imaging-request-document", () => ({ ImagingRequestDocument: ({ data }: { data: unknown }) => data }));
const fetchDocumentFolios = jest.fn();
class Refused extends Error {}
jest.mock("@/lib/clinical/document-folio", () => ({ DocumentFolioRefusedError: Refused, fetchDocumentFolios: (...a: unknown[]) => fetchDocumentFolios(...a) }));

import { generateImagingRequestPdf } from "./generate-imaging-request-pdf";

type Row = Record<string, unknown> | null;
function client(tables: Record<string, Row>) {
  return {
    from: (t: string) => {
      const chain: Record<string, unknown> = {};
      for (const m of ["select", "eq", "in"]) chain[m] = () => chain;
      chain.maybeSingle = async () => ({ data: tables[t] ?? null, error: null });
      return chain;
    },
  } as never;
}
const order = {
  id: "o1234567-0000", created_at: "2026-11-05T09:00:00Z", patient_id: "p1", status: "ordered", urgency: "routine",
  indication: "Chest pain on exertion", clinical_information: null, contraindication_information: "Not pregnant",
  ordering_clinician_id: "s1", study: { name: "Chest X-ray" },
};
const patient = { full_name: "Ada", patient_number: "TH-1", date_of_birth: "1980-01-01", sex: "female" };

beforeEach(() => { renderToBuffer.mockClear(); fetchDocumentFolios.mockReset(); });

describe("generateImagingRequestPdf", () => {
  it("prints the study, reason and the doctor from the folio, and names no place or price", async () => {
    fetchDocumentFolios.mockResolvedValue(new Map([["o1234567-0000", { fullName: "Dr Bello", credentialType: "MDCN", credentialNumber: "123" }]]));
    const r = await generateImagingRequestPdf(client({ imaging_orders: order, profiles: patient }), "o1234567-0000");
    expect(r.ok).toBe(true);
    const data = (renderToBuffer.mock.calls[0] as unknown[])[0] as Record<string, unknown>;
    expect(data).toEqual(expect.objectContaining({ studyName: "Chest X-ray", indication: "Chest pain on exertion", requestedByName: "Dr Bello", requestedByCredentialNumber: "123" }));
    expect(Object.keys(data).some((k) => /price|kobo|centre|branch|location|provider/i.test(k))).toBe(false);
  });
  it("a refused folio produces no PDF rather than an unnumbered one", async () => {
    fetchDocumentFolios.mockRejectedValue(new Refused("no"));
    expect(await generateImagingRequestPdf(client({ imaging_orders: order, profiles: patient }), "o1234567-0000")).toEqual({ ok: false, error: "not_found" });
  });
  it("a cancelled or unreadable order is not found", async () => {
    expect(await generateImagingRequestPdf(client({ imaging_orders: { ...order, status: "cancelled" }, profiles: patient }), "x")).toEqual({ ok: false, error: "not_found" });
    expect(await generateImagingRequestPdf(client({ profiles: patient }), "x")).toEqual({ ok: false, error: "not_found" });
  });
});
