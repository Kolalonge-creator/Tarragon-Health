import { beforeEach, describe, expect, it, jest } from "@jest/globals";

type Row = { kind: string; audio_url: string | null } | null;
let user: { id: string } | null = { id: "u1" };
let row: Row = { kind: "meditation", audio_url: "media-library/MED-CRS-01.mp3" };
let rowError: unknown = null;
let signed: { signedUrl: string } | null = { signedUrl: "https://storage.example/signed" };
const createSignedUrl = jest.fn(async (_path: string, _secs: number) => ({ data: signed, error: signed ? null : { message: "x" } }));
const fetchMock = jest.fn<typeof fetch>();

jest.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    auth: { getUser: async () => ({ data: { user } }) },
    from: () => ({ select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: row, error: rowError }) }) }) }),
  }),
}));
jest.mock("@/lib/supabase/service-role", () => ({
  createServiceRoleClient: () => ({ storage: { from: (_b: string) => ({ createSignedUrl }) } }),
}));

import { GET } from "./route";

const call = (code: string, headers: Record<string, string> = {}) =>
  GET(new Request(`http://x/api/media/${code}/stream`, { headers }), { params: Promise.resolve({ code }) });

beforeEach(() => {
  user = { id: "u1" };
  row = { kind: "meditation", audio_url: "media-library/MED-CRS-01.mp3" };
  rowError = null;
  signed = { signedUrl: "https://storage.example/signed" };
  createSignedUrl.mockClear();
  fetchMock.mockReset();
  fetchMock.mockResolvedValue(new Response("abc", { status: 200, headers: { "content-length": "3" } }));
  globalThis.fetch = fetchMock;
});

describe("GET /api/media/{code}/stream", () => {
  it("streams the file inline, never cached and never as a download", async () => {
    const res = await call("med-crs-01");
    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toBe("audio/mpeg");
    expect(res.headers.get("Content-Disposition")).toBe("inline");
    expect(res.headers.get("Cache-Control")).toBe("private, no-store");
    expect(createSignedUrl).toHaveBeenCalledWith("media-library/MED-CRS-01.mp3", 60);
  });
  it("passes the Range header on and returns a partial answer", async () => {
    fetchMock.mockResolvedValue(new Response("b", { status: 206, headers: { "content-range": "bytes 1-1/3", "content-length": "1" } }));
    const res = await call("med-crs-01", { range: "bytes=1-1" });
    expect(res.status).toBe(206);
    expect(res.headers.get("Content-Range")).toBe("bytes 1-1/3");
    expect((fetchMock.mock.calls[0][1] as RequestInit).headers).toEqual({ range: "bytes=1-1" });
  });
  it("needs a signed-in person", async () => {
    user = null;
    expect((await call("med-crs-01")).status).toBe(401);
    expect(createSignedUrl).not.toHaveBeenCalled();
  });
  it("gives nothing when the catalogue policy returns no row (draft, expired, placeholder)", async () => {
    row = null;
    expect((await call("med-crs-01")).status).toBe(404);
    expect(createSignedUrl).not.toHaveBeenCalled();
  });
  it("refuses opening the address as a page so it cannot be saved from a tab", async () => {
    expect((await call("med-crs-01", { "sec-fetch-dest": "document" })).status).toBe(403);
    expect(createSignedUrl).not.toHaveBeenCalled();
    expect((await call("med-crs-01", { "sec-fetch-dest": "audio" })).status).toBe(200);
  });
  it("refuses a bad code, a non-audio kind and a path outside the library folder", async () => {
    expect((await call("../etc")).status).toBe(404);
    row = { kind: "exercise", audio_url: "media-library/x.mp3" };
    expect((await call("med-crs-01")).status).toBe(404);
    row = { kind: "meditation", audio_url: "other/x.mp3" };
    expect((await call("med-crs-01")).status).toBe(404);
    row = { kind: "meditation", audio_url: "media-library/../secret.mp3" };
    expect((await call("med-crs-01")).status).toBe(404);
  });
  it("a failed catalogue read is an error, not a silent empty answer", async () => {
    rowError = { message: "boom" };
    expect((await call("med-crs-01")).status).toBe(502);
  });
});
