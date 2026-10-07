/**
 * The public share door (S43, spec 2.8): the HTTP contract.
 * Acceptance test: an expired share link returns 410. (The database half, that the
 * attempt is logged against the link, is proved in packages/db/tests/s43_health_passport.sql.)
 */

const openShare = jest.fn();
jest.mock("@/lib/record-share/open", () => ({ openShare: (...args: unknown[]) => openShare(...args) }));

import { GET, POST } from "./route";

const TOKEN = "cd".repeat(32);
const ctx = { params: Promise.resolve({ token: TOKEN }) };

function post(body: Record<string, string>) {
  const form = new FormData();
  for (const [k, v] of Object.entries(body)) form.set(k, v);
  return new Request(`https://app.test/share/${TOKEN}`, { method: "POST", body: form });
}

beforeEach(() => openShare.mockReset());

describe("GET /share/[token]", () => {
  it("returns 410 for an expired link and shows no record", async () => {
    openShare.mockResolvedValue({ status: "gone", reason: "expired" });
    const res = await GET(new Request("https://app.test"), ctx);
    expect(res.status).toBe(410);
    expect(await res.text()).not.toContain("Ada");
  });

  it.each([["revoked"], ["view_cap"]] as const)("returns 410 for a link that was %s", async (reason) => {
    openShare.mockResolvedValue({ status: "gone", reason });
    expect((await GET(new Request("https://app.test"), ctx)).status).toBe(410);
  });

  it("returns 404 for an unknown link, 401 when a PIN is needed, 423 when locked", async () => {
    openShare.mockResolvedValue({ status: "not_found" });
    expect((await GET(new Request("https://app.test"), ctx)).status).toBe(404);
    openShare.mockResolvedValue({ status: "pin_required" });
    expect((await GET(new Request("https://app.test"), ctx)).status).toBe(401);
    openShare.mockResolvedValue({ status: "locked" });
    expect((await GET(new Request("https://app.test"), ctx)).status).toBe(423);
  });

  it("returns 200 with the record, never cached, never indexed, no script allowed", async () => {
    openShare.mockResolvedValue({
      status: "ok",
      record: { full_name: "Ada Okafor", shared_at: "2026-10-01T00:00:00Z", expires_at: "2026-10-04T00:00:00Z", sections: [] },
    });
    const res = await GET(new Request("https://app.test"), ctx);
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toContain("no-store");
    expect(res.headers.get("x-robots-tag")).toContain("noindex");
    expect(res.headers.get("content-security-policy")).toContain("default-src 'none'");
    expect(await res.text()).toContain("Ada Okafor");
  });

  it("a plain GET never carries a PIN", async () => {
    openShare.mockResolvedValue({ status: "pin_required" });
    await GET(new Request(`https://app.test/share/${TOKEN}?pin=1234`), ctx);
    expect(openShare).toHaveBeenCalledWith(TOKEN, null);
  });
});

describe("POST /share/[token]", () => {
  it("passes the PIN from the form body", async () => {
    openShare.mockResolvedValue({ status: "pin_wrong", attempts_left: 4 });
    const res = await POST(post({ pin: " 4821 " }), ctx);
    expect(openShare).toHaveBeenCalledWith(TOKEN, "4821");
    expect(res.status).toBe(401);
  });

  it("treats a body that is not a form as no PIN", async () => {
    openShare.mockResolvedValue({ status: "pin_required" });
    const res = await POST(new Request(`https://app.test/share/${TOKEN}`, { method: "POST", body: "not a form", headers: { "content-type": "text/plain" } }), ctx);
    expect(openShare).toHaveBeenCalledWith(TOKEN, null);
    expect(res.status).toBe(401);
  });
});
