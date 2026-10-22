const imageCtor = jest.fn();
jest.mock("server-only", () => ({}));
jest.mock("next/og", () => ({
  ImageResponse: class {
    element: unknown;
    options: unknown;
    status = 200;
    constructor(element: unknown, options: unknown) {
      imageCtor(element, options);
      this.element = element;
      this.options = options;
    }
  },
}));
const loadDataset = jest.fn();
jest.mock("./dataset", () => ({ loadEmergencyDatasetForPatient: (...a: unknown[]) => loadDataset(...a) }));
const mockQr = jest.fn(async (_text: string) => "<svg></svg>");
jest.mock("./qr-render", () => ({ emergencyTextQrSvg: (text: string) => mockQr(text) }));

import { lockScreenImageResponse, lockScreenOptionsFromUrl } from "./lock-screen-image-response";

const calls: string[] = [];
const rpc = jest.fn();
let fieldsRow: Record<string, unknown> | null = null;
let fieldsError: unknown = null;

const supabase = {
  from: () => ({ select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: fieldsRow, error: fieldsError }) }) }) }),
  rpc: (...a: unknown[]) => {
    calls.push("rpc");
    return rpc(...a);
  },
} as never;

const row = (over: Record<string, unknown> = {}) => ({
  show_date_of_birth: true, show_sex: true, show_patient_number: true, show_allergies: true, show_medications: true, show_conditions: false,
  show_blood: true, show_emergency_contact: true, show_reproductive: false, show_mental_health: false, lock_screen_opt_in: true, ...over,
});

const facts = {
  full_name: "Ada Obi", date_of_birth: "1984-03-02", sex: "female", patient_number: "TH-1", emergency_contact: null,
  allergies: [], medications: [{ drug_name: "Amlodipine", dose: null, frequency: null }], conditions: [], blood: null,
};

beforeEach(() => {
  jest.clearAllMocks();
  calls.length = 0;
  fieldsRow = row();
  fieldsError = null;
  rpc.mockResolvedValue({ data: { ok: true }, error: null });
  loadDataset.mockImplementation(async () => {
    calls.push("dataset");
    return facts;
  });
});

describe("lockScreenImageResponse", () => {
  it("is 403 when the person's own switch is off, and reads and audits nothing", async () => {
    fieldsRow = row({ lock_screen_opt_in: false });
    const res = await lockScreenImageResponse({ supabase, userId: "u1", options: { includeQr: true, minimum: true } });
    expect(res.status).toBe(403);
    expect(rpc).not.toHaveBeenCalled();
    expect(loadDataset).not.toHaveBeenCalled();
    expect(imageCtor).not.toHaveBeenCalled();
  });

  it("is 403 when the person has no card row at all (off by default)", async () => {
    fieldsRow = null;
    expect((await lockScreenImageResponse({ supabase, userId: "u1", options: { includeQr: true, minimum: true } })).status).toBe(403);
    expect(imageCtor).not.toHaveBeenCalled();
  });

  it("audits BEFORE the facts are read or anything is drawn", async () => {
    await lockScreenImageResponse({ supabase, userId: "u1", options: { includeQr: false, minimum: true } });
    expect(calls).toEqual(["rpc", "dataset"]);
    expect(rpc).toHaveBeenCalledWith("record_emergency_card_image", { p_include_qr: false, p_minimum: true });
  });

  it("a refused audit door is 403 and no picture is drawn; any other failure is 503, never a picture", async () => {
    rpc.mockResolvedValue({ data: null, error: { code: "42501", message: "card_image_not_opted_in" } });
    expect((await lockScreenImageResponse({ supabase, userId: "u1", options: { includeQr: true, minimum: true } })).status).toBe(403);
    rpc.mockResolvedValue({ data: null, error: { code: "XX000", message: "boom" } });
    expect((await lockScreenImageResponse({ supabase, userId: "u1", options: { includeQr: true, minimum: true } })).status).toBe(503);
    expect(imageCtor).not.toHaveBeenCalled();
    expect(loadDataset).not.toHaveBeenCalled();
  });

  it("a failed clinical read is 503 and never a picture that says none recorded", async () => {
    loadDataset.mockRejectedValueOnce(new Error("emergency dataset read failed"));
    const res = await lockScreenImageResponse({ supabase, userId: "u1", options: { includeQr: true, minimum: true } });
    expect(res.status).toBe(503);
    expect(loadDataset).toHaveBeenCalledWith(expect.anything(), "u1", { strict: true });
    expect(imageCtor).not.toHaveBeenCalled();
  });

  it("the phone route can ask for an inline picture so it shows in the in-app browser", async () => {
    await lockScreenImageResponse({ supabase, userId: "u1", options: { includeQr: false, minimum: true }, disposition: "inline" });
    const opts = imageCtor.mock.calls[0]![1] as { headers: Record<string, string> };
    expect(opts.headers["Content-Disposition"]).toBe('inline; filename="emergency-card-lock-screen.png"');
  });

  it("a failed read of the card row is 503, not 'off'", async () => {
    fieldsError = { message: "x" };
    expect((await lockScreenImageResponse({ supabase, userId: "u1", options: { includeQr: true, minimum: true } })).status).toBe(503);
  });

  it("draws a portrait phone-sized picture with no cache and a file name that says nothing about the person", async () => {
    await lockScreenImageResponse({ supabase, userId: "u1", options: { includeQr: true, minimum: true } });
    const opts = imageCtor.mock.calls[0]![1] as { width: number; height: number; headers: Record<string, string>; fonts: unknown[] };
    expect(opts.width).toBe(1170);
    expect(opts.height).toBe(2532);
    expect(opts.headers["Cache-Control"]).toBe("private, no-store");
    expect(opts.headers["Content-Disposition"]).toBe('attachment; filename="emergency-card-lock-screen.png"');
    expect(opts.fonts).toHaveLength(2);
  });

  it("the minimum is applied: a medicine the person shows on the card is not on the picture by default, but is with the minimum off", async () => {
    await lockScreenImageResponse({ supabase, userId: "u1", options: { includeQr: false, minimum: true } });
    const minEl = JSON.stringify((imageCtor.mock.calls[0]![0] as { props: unknown }).props);
    expect(minEl).not.toContain("Amlodipine");
    await lockScreenImageResponse({ supabase, userId: "u1", options: { includeQr: false, minimum: false } });
    const allEl = JSON.stringify((imageCtor.mock.calls[1]![0] as { props: unknown }).props);
    expect(allEl).toContain("Amlodipine");
  });

  it("the QR is on the picture only when chosen", async () => {
    await lockScreenImageResponse({ supabase, userId: "u1", options: { includeQr: true, minimum: true } });
    expect((imageCtor.mock.calls[0]![0] as { props: { qrDataUri: string | null } }).props.qrDataUri).toMatch(/^data:image\/svg\+xml;base64,/);
    await lockScreenImageResponse({ supabase, userId: "u1", options: { includeQr: false, minimum: true } });
    expect((imageCtor.mock.calls[1]![0] as { props: { qrDataUri: string | null } }).props.qrDataUri).toBeNull();
  });
});

describe("HMO / NHIA cover (S09y) is never on the lock-screen picture", () => {
  const cover = { scheme: "hmo", member_number: "REL/99887", plan_name: "Reliance Gold", provenance: "patient_entered" };

  it("is not requested from the dataset, and is stripped even if a dataset ever returned it: not on the picture and not in its QR text", async () => {
    loadDataset.mockImplementation(async () => ({ ...facts, coverage: cover }));
    await lockScreenImageResponse({ supabase, userId: "u1", options: { includeQr: true, minimum: false } });
    expect(loadDataset).toHaveBeenCalledWith(supabase, "u1", { strict: true });
    const props = JSON.stringify((imageCtor.mock.calls[0]![0] as { props: unknown }).props);
    expect(props).not.toContain("REL/99887");
    expect(props).not.toContain("Reliance");
    expect(mockQr).toHaveBeenCalledTimes(1);
    expect(mockQr.mock.calls[0]![0]).not.toMatch(/REL\/99887|Reliance|Cover:/);
  });
});

describe("lockScreenOptionsFromUrl", () => {
  it("defaults to the safe side (minimum on, QR on) and reads an explicit 0", () => {
    expect(lockScreenOptionsFromUrl(new URL("https://x.test/a"))).toEqual({ includeQr: true, minimum: true });
    expect(lockScreenOptionsFromUrl(new URL("https://x.test/a?qr=0&minimum=0"))).toEqual({ includeQr: false, minimum: false });
  });
});
