const getUser = jest.fn();
const readingsQuery = jest.fn();
const orderArgs = jest.fn();
const gteArgs = jest.fn();
let mockRows: unknown[] = [];
jest.mock("@react-pdf/renderer", () => ({
  Document: "Document",
  Page: "Page",
  Text: "Text",
  View: "View",
  StyleSheet: { create: (s: unknown) => s },
  renderToBuffer: async () => Buffer.from("%PDF-fake"),
}));
jest.mock("@/lib/patient/glucose-unit", () => ({ getGlucoseDisplayUnit: async () => "mg_dl" }));
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
              gte: (c: string, v: string) => {
                gteArgs(c, v);
                return {
                  order: (col: string, opts: unknown) => {
                    orderArgs(col, opts);
                    return { limit: async () => ({ data: mockRows, error: null }) };
                  },
                };
              },
            };
          },
        }),
      };
    },
  }),
}));

import { GET } from "./route";

describe("GET /api/patient/visit-report/pdf", () => {
  beforeEach(() => {
    mockRows = [];
    orderArgs.mockClear();
    gteArgs.mockClear();
    getUser.mockResolvedValue({ data: { user: { id: "user-1" } } });
  });

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

  it("asks for newest first so a row cap never drops the latest readings", async () => {
    await GET(new Request("http://localhost/api/patient/visit-report/pdf"));
    expect(orderArgs).toHaveBeenCalledWith("taken_at", { ascending: false });
  });

  it("falls back to 30 days for a bad or missing days value, and honours 7 and 90", async () => {
    const days = async (q: string): Promise<number> => {
      gteArgs.mockClear();
      await GET(new Request(`http://localhost/api/patient/visit-report/pdf${q}`));
      const since = new Date(gteArgs.mock.calls[0]![1] as string).getTime();
      return Math.round((Date.now() - since) / 86_400_000);
    };
    expect(await days("")).toBe(30);
    expect(await days("?days=abc")).toBe(30);
    expect(await days("?days=365")).toBe(30);
    expect(await days("?days=7")).toBe(7);
    expect(await days("?days=90")).toBe(90);
  });
});
