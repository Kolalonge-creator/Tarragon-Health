const mockGetProfile = jest.fn();
const mockActing = jest.fn();
const mockSearch = jest.fn();

jest.mock("@/lib/auth/current-profile", () => ({ getCurrentProfile: () => mockGetProfile() }));
jest.mock("@/lib/acting/acting-for", () => ({ getActingFor: () => mockActing() }));
jest.mock("@/lib/supabase/server", () => ({ createClient: async () => ({}) }));
jest.mock("@/lib/patient/record-search", () => ({
  searchPatientRecord: (...args: unknown[]) => mockSearch(...args),
}));

import { GET } from "./route";

const req = (q: string) => new Request(`http://localhost/api/patient/search?q=${encodeURIComponent(q)}`);

beforeEach(() => {
  jest.clearAllMocks();
  mockGetProfile.mockResolvedValue({ id: "u1", role: "patient" });
  mockActing.mockResolvedValue(null);
  mockSearch.mockResolvedValue({ results: [], failed: false });
});

describe("GET /api/patient/search", () => {
  it("refuses anyone who is not signed in, and staff", async () => {
    mockGetProfile.mockResolvedValueOnce(null);
    expect((await GET(req("metformin"))).status).toBe(401);
    mockGetProfile.mockResolvedValueOnce({ id: "s1", role: "clinician" });
    expect((await GET(req("metformin"))).status).toBe(403);
    expect(mockSearch).not.toHaveBeenCalled();
  });

  it("searches the patient's own record", async () => {
    await GET(req("metformin"));
    expect(mockSearch).toHaveBeenCalledWith({}, { userId: "u1", subjectId: "u1" }, "metformin");
  });

  it("searches the record of the person being acted for", async () => {
    mockActing.mockResolvedValue({ profileId: "p2", fullName: "Mum" });
    await GET(req("metformin"));
    expect(mockSearch).toHaveBeenCalledWith({}, { userId: "u1", subjectId: "p2" }, "metformin");
  });

  it("answers a failure as failed, never as an empty match list", async () => {
    mockSearch.mockRejectedValue(new Error("down"));
    const body = await (await GET(req("metformin"))).json();
    expect(body).toEqual({ results: [], failed: true });
  });

  it("does not search a query that is too short", async () => {
    const body = await (await GET(req("m"))).json();
    expect(body).toEqual({ results: [], failed: false });
    expect(mockSearch).not.toHaveBeenCalled();
  });
});
