/**
 * OQ-666: the admin / CMO people search finds a clinician by MDCN folio again, through the staff-only
 * search_clinical_staff_by_folio function, without ever filtering on the (now locked) credential_number column.
 */
const mockGetProfile = jest.fn();
const mockGetStaff = jest.fn();
const mockRpc = jest.fn();
const mockOr = jest.fn();
const mockIn = jest.fn();

jest.mock("@/lib/auth/current-profile", () => ({
  getCurrentProfile: () => mockGetProfile(),
  getCurrentClinicalStaff: () => mockGetStaff(),
}));
jest.mock("@/lib/clinical/doctor-tier", () => ({ canAssignCases: () => true }));
jest.mock("@/lib/supabase/service-role", () => ({
  createServiceRoleClient: () => ({
    from: () => ({ select: () => ({ eq: () => ({ or: () => ({ limit: async () => ({ data: [], error: null }) }) }) }) }),
  }),
}));
jest.mock("@/lib/credentialing/rpc", () => ({ rpcParsed: jest.fn().mockResolvedValue([]) }));
const mockSearchRecords = jest.fn();
jest.mock("@/lib/admin-search-records", () => ({ searchRecords: (...args: unknown[]) => mockSearchRecords(...args) }));
jest.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    rpc: (fn: string, args: unknown) => mockRpc(fn, args),
    from: () => ({
      select: () => ({
        or: (filter: string) => {
          mockOr(filter);
          return { limit: async () => ({ data: [{ id: "s-name", full_name: "Ada Name", staff_number: "S-1", active: true }], error: null }) };
        },
        in: async (_col: string, ids: string[]) => {
          mockIn(ids);
          return { data: ids.map((id) => ({ id, full_name: "Folio Match", staff_number: "S-2", active: true })), error: null };
        },
      }),
    }),
  }),
}));

import { GET } from "./route";

const req = (q: string) => new Request(`http://localhost/api/admin/search?q=${encodeURIComponent(q)}`);

beforeEach(() => {
  jest.clearAllMocks();
  mockGetProfile.mockResolvedValue({ role: "admin" });
  mockSearchRecords.mockResolvedValue({ results: [], failed: false });
  mockRpc.mockImplementation(async (fn: string) => {
    if (fn === "search_clinical_staff_by_folio") return { data: [{ clinical_staff_id: "s-folio" }, { clinical_staff_id: "s-name" }], error: null };
    if (fn === "clinical_staff_folio") return { data: [{ clinical_staff_id: "s-folio", credential_number: "MDCN/777" }], error: null };
    return { data: null, error: null };
  });
});

describe("GET /api/admin/search clinicians (OQ-666)", () => {
  it("never filters on credential_number in the table query", async () => {
    await GET(req("MDCN/777"));
    expect(mockOr).toHaveBeenCalled();
    expect(String(mockOr.mock.calls[0][0])).not.toContain("credential_number");
  });

  it("adds a clinician found by folio, once, and shows the folio from the folio function", async () => {
    const res = await GET(req("MDCN/777"));
    const body = (await res.json()) as { results: { label: string; group: string; hint: string }[] };
    expect(mockRpc).toHaveBeenCalledWith("search_clinical_staff_by_folio", { p_term: "MDCN/777" });
    // s-name was already found by name, so only s-folio is fetched in addition
    expect(mockIn).toHaveBeenCalledWith(["s-folio"]);
    const clinicians = body.results.filter((r) => r.group === "Clinicians");
    expect(clinicians.map((c) => c.label)).toEqual(["Ada Name", "Folio Match"]);
    expect(clinicians[1].hint).toContain("MDCN MDCN/777");
  });

  it("when the folio search fails the name results still come back", async () => {
    jest.spyOn(console, "error").mockImplementation(() => undefined);
    mockRpc.mockImplementation(async (fn: string) =>
      fn === "search_clinical_staff_by_folio" ? { data: null, error: { code: "PGRST202" } } : { data: [], error: null },
    );
    const res = await GET(req("Ada"));
    const body = (await res.json()) as { results: { label: string }[]; failed: boolean };
    expect(body.results.map((r) => r.label)).toContain("Ada Name");
    // the box is told a source was unavailable, not shown a shorter list as complete
    expect(body.failed).toBe(true);
    expect(mockIn).not.toHaveBeenCalled();
  });

  it("refuses a patient before any lookup", async () => {
    mockGetProfile.mockResolvedValue({ role: "patient" });
    expect((await GET(req("MDCN/777"))).status).toBe(403);
    expect(mockRpc).not.toHaveBeenCalled();
  });
});

describe("GET /api/admin/search records (superadmin console 2c)", () => {
  it("adds employer, incident and order results for the admin, through the admin's own session", async () => {
    mockSearchRecords.mockResolvedValue({
      results: [{ label: "Order T2REF123", href: "/admin/patients?q=TH-1", group: "Payments", hint: "paid" }],
      failed: false,
    });
    const res = await GET(req("T2REF123"));
    const body = (await res.json()) as { results: { group: string }[]; failed: boolean };
    expect(body.results.some((r) => r.group === "Payments")).toBe(true);
    const [client, term, needle] = mockSearchRecords.mock.calls[0];
    // the session client (it has .rpc from the server mock), never the service-role client
    expect(typeof (client as { rpc?: unknown }).rpc).toBe("function");
    expect([term, needle]).toEqual(["T2REF123", "t2ref123"]);
  });

  it("passes a failed record source on to the box", async () => {
    mockSearchRecords.mockResolvedValue({ results: [], failed: true });
    const body = (await (await GET(req("acme"))).json()) as { failed: boolean };
    expect(body.failed).toBe(true);
  });

  it("never searches records for the Chief Medical Officer", async () => {
    mockGetProfile.mockResolvedValue({ role: "clinician" });
    await GET(req("acme"));
    expect(mockSearchRecords).not.toHaveBeenCalled();
  });
});

