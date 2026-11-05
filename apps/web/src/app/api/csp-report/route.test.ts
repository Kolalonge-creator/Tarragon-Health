import { NextRequest } from "next/server";

const rateLimit = jest.fn();
jest.mock("@/lib/rate-limit", () => ({
  rateLimit: (...args: unknown[]) => rateLimit(...args),
  getClientIp: async () => "203.0.113.9",
}));

// eslint-disable-next-line @typescript-eslint/no-require-imports
const { POST } = require("./route") as typeof import("./route");

function post(body: string) {
  return new NextRequest("https://app.tarragonhealth.ng/api/csp-report", { method: "POST", body });
}

const report = JSON.stringify({
  "csp-report": {
    "effective-directive": "script-src-elem",
    "blocked-uri": "https://evil.example/x.js?k=1",
    "document-uri": "https://app.tarragonhealth.ng/share/AbCd1234?token=secret",
  },
});

let warn: jest.SpyInstance;
beforeEach(() => {
  rateLimit.mockReset();
  rateLimit.mockResolvedValue({ success: true });
  warn = jest.spyOn(console, "warn").mockImplementation(() => undefined);
});
afterEach(() => warn.mockRestore());

describe("POST /api/csp-report", () => {
  it("logs a sanitised summary and answers 204 with no body", async () => {
    const res = await POST(post(report));
    expect(res.status).toBe(204);
    expect(await res.text()).toBe("");
    expect(warn).toHaveBeenCalledWith("csp-report-only violation", {
      directive: "script-src-elem",
      blocked: "https://evil.example",
      path: "/share/:id",
      disposition: null,
    });
    expect(JSON.stringify(warn.mock.calls)).not.toContain("secret");
  });

  it("drops reports over the rate limit, oversized bodies and junk, still 204", async () => {
    rateLimit.mockResolvedValueOnce({ success: false });
    expect((await POST(post(report))).status).toBe(204);
    expect((await POST(post("x".repeat(17 * 1024)))).status).toBe(204);
    expect((await POST(post("not json"))).status).toBe(204);
    expect((await POST(post("42"))).status).toBe(204);
    expect(warn).not.toHaveBeenCalled();
  });
});
