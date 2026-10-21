import { FIXTURE_CATALOGUE } from "@/lib/nutrition/test-fixtures";

let catalogue: unknown[] = FIXTURE_CATALOGUE;
jest.mock("@/lib/nutrition/food-catalogue-fetch", () => ({ fetchFoodCatalogue: async () => catalogue }));
let user: { id: string } | null = { id: "p1" };
jest.mock("@/lib/supabase/bearer", () => ({
  createBearerClient: () => ({ auth: { getUser: async () => ({ data: { user }, error: user ? null : { message: "bad" } }) } }),
}));

import { GET } from "./route";

const req = (headers: Record<string, string> = { authorization: "Bearer t" }) => new Request("http://x/api/mobile/nutrition/food-list", { headers });

beforeEach(() => {
  catalogue = FIXTURE_CATALOGUE;
  user = { id: "p1" };
});

describe("GET /api/mobile/nutrition/food-list", () => {
  it("401 without a token or with a bad session", async () => {
    expect((await GET(req({}))).status).toBe(401);
    user = null;
    expect((await GET(req())).status).toBe(401);
  });

  it("returns the compact list with a content-hash ETag", async () => {
    const res = await GET(req());
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.rows.length).toBe(FIXTURE_CATALOGUE.length);
    expect(res.headers.get("etag")).toBe(`"${body.version}"`);
  });

  it("answers 304 with no body when the phone already has this version", async () => {
    const first = await GET(req());
    const etag = first.headers.get("etag")!;
    const second = await GET(req({ authorization: "Bearer t", "if-none-match": etag }));
    expect(second.status).toBe(304);
  });

  it("an empty catalogue is a 503, never an empty list that would wipe the phone's copy", async () => {
    catalogue = [];
    expect((await GET(req())).status).toBe(503);
  });
});
