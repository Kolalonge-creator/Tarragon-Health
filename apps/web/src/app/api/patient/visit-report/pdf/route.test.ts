const getUser = jest.fn();
const readingsQuery = jest.fn();
jest.mock("@react-pdf/renderer", () => ({
  Document: "Document",
  Page: "Page",
  Text: "Text",
  View: "View",
  StyleSheet: { create: (s: unknown) => s },
  renderToBuffer: async () => Buffer.from("%PDF-fake"),
}));
jest.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    auth: { getUser },
    from: (table: string) => {
      if (table === "profiles") {
        return {
          select: () => ({
            eq: () => ({
              maybeSingle: async () => ({ data: { full_name: "Pat", role: "patient" } }),
            }),
          }),
        };
      }
      return {
        select: () => ({
          eq: (col: string, val: string) => {
            readingsQuery(col, val);
            return {
              gte: () => ({
                order: () => ({ limit: async () => ({ data: [], error: null }) }),
              }),
            };
          },
        }),
      };
    },
  }),
}));

import { GET } from "./route";

describe("GET /api/patient/visit-report/pdf", () => {
  it("refuses a request with no session", async () => {
    getUser.mockResolvedValue({ data: { user: null } });
    const res = await GET(new Request("http://localhost/api/patient/visit-report/pdf"));
    expect(res.status).toBe(401);
  });

  it("reads only the signed-in user's own readings and returns a PDF", async () => {
    getUser.mockResolvedValue({ data: { user: { id: "user-1" } } });
    const res = await GET(new Request("http://localhost/api/patient/visit-report/pdf?days=7"));
    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toBe("application/pdf");
    expect(res.headers.get("Cache-Control")).toBe("private, no-store");
    expect(readingsQuery).toHaveBeenCalledWith("patient_id", "user-1");
  });
});
