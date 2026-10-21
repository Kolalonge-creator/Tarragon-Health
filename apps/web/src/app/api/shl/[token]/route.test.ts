const openShare = jest.fn();
jest.mock("@/lib/my-health/open-share", () => ({
  openShare: (...a: unknown[]) => openShare(...a),
  isWellFormedPin: (p: string) => /^[0-9]{4,12}$/.test(p),
  clientKeyFromHeaders: (h: { get(n: string): string | null | undefined }) => h.get("x-forwarded-for")?.split(",")[0]?.trim() || h.get("x-real-ip") || null,
}));
const buildBundle = jest.fn();
jest.mock("@/lib/my-health/share-fhir", () => {
  const actual = jest.requireActual("@/lib/my-health/share-fhir");
  return { ...actual, buildSharedRecordBundle: (...a: unknown[]) => buildBundle(...a) };
});

import { createDecipheriv } from "node:crypto";
import { inflateRawSync } from "node:zlib";
import { deriveShlKey } from "@/lib/my-health/smart-health-link";
import { OPTIONS, POST } from "./route";

const SECRET = "s".repeat(40);
const TOKEN = "d".repeat(64);
const OK_RECORD = {
  status: "ok",
  full_name: "Test Person",
  shared_at: "2026-10-20T09:00:00+00:00",
  expires_at: "2026-10-27T09:00:00+00:00",
  sections: ["allergies"],
  allergies: [{ allergen: "Penicillin", reaction: "Rash", severity: "moderate" }],
};

const call = (body: unknown, token = TOKEN) =>
  POST(new Request(`https://app.example.test/api/shl/${token}`, { method: "POST", body: typeof body === "string" ? body : JSON.stringify(body), headers: { "x-forwarded-for": "203.0.113.9, 10.0.0.1" } }), {
    params: Promise.resolve({ token }),
  });

function open(embedded: string): string {
  const [h, , iv, ct, tag] = embedded.split(".") as [string, string, string, string, string];
  const d = createDecipheriv("aes-256-gcm", deriveShlKey(TOKEN, SECRET) as Buffer, Buffer.from(iv, "base64url"));
  d.setAAD(Buffer.from(h, "ascii"));
  d.setAuthTag(Buffer.from(tag, "base64url"));
  return inflateRawSync(Buffer.concat([d.update(Buffer.from(ct, "base64url")), d.final()])).toString("utf8");
}

beforeEach(() => {
  openShare.mockReset();
  buildBundle.mockReset();
  buildBundle.mockImplementation(((jest.requireActual("@/lib/my-health/share-fhir") as typeof import("@/lib/my-health/share-fhir")).buildSharedRecordBundle));
  process.env.SHARE_LINK_KEY_SECRET = SECRET;
});
afterAll(() => {
  delete process.env.SHARE_LINK_KEY_SECRET;
});

describe("SMART Health Link manifest", () => {
  it("answers a link with no PIN with one encrypted FHIR bundle, and passes the first client address on", async () => {
    openShare.mockResolvedValue({ kind: "ok", record: OK_RECORD });
    const res = await call({ recipient: "Lagos Clinic" });
    expect(res.status).toBe(200);
    expect(openShare).toHaveBeenCalledWith(TOKEN, null, "203.0.113.9");
    const manifest = (await res.json()) as { files: Array<{ contentType: string; embedded: string }> };
    const bundle = JSON.parse(open(manifest.files[0]?.embedded as string)) as { resourceType: string; entry: unknown[] };
    expect(bundle.resourceType).toBe("Bundle");
    expect(bundle.entry.length).toBeGreaterThan(1);
  });

  it("sends no-store and allows any origin", async () => {
    openShare.mockResolvedValue({ kind: "ok", record: OK_RECORD });
    const res = await call({});
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(res.headers.get("access-control-allow-origin")).toBe("*");
    expect(OPTIONS().status).toBe(204);
  });

  it("passes the passcode to the share door and answers a needed or wrong PIN with 401 and the attempts left", async () => {
    openShare.mockResolvedValue({ kind: "pin_required", attemptsLeft: 3 });
    const res = await call({ passcode: "123456" });
    expect(openShare).toHaveBeenCalledWith(TOKEN, "123456", "203.0.113.9");
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ remainingAttempts: 3 });
  });

  it("never sends a malformed passcode to the database (it cannot burn an attempt)", async () => {
    const res = await call({ passcode: "12ab" });
    expect(res.status).toBe(401);
    expect(openShare).not.toHaveBeenCalled();
  });

  it("gives a locked link 429 and every other dead link the same plain 404", async () => {
    openShare.mockResolvedValueOnce({ kind: "try_later" });
    expect((await call({})).status).toBe(429);
    openShare.mockResolvedValueOnce({ kind: "unavailable" });
    expect((await call({})).status).toBe(404);
  });

  it("refuses a malformed token and a malformed body before touching anything", async () => {
    expect((await call({}, "short")).status).toBe(404);
    expect((await call("{not json")).status).toBe(400);
    expect((await call({ embeddedLengthMax: -1 })).status).toBe(400);
    expect(openShare).not.toHaveBeenCalled();
  });

  it("answers 503, never an unencrypted record, when the server has no link secret", async () => {
    delete process.env.SHARE_LINK_KEY_SECRET;
    openShare.mockResolvedValue({ kind: "ok", record: OK_RECORD });
    expect((await call({})).status).toBe(503);
    expect(openShare).not.toHaveBeenCalled();
  });

  it("answers 413 when the recipient cannot take the file inline", async () => {
    openShare.mockResolvedValue({ kind: "ok", record: OK_RECORD });
    expect((await call({ embeddedLengthMax: 20 })).status).toBe(413);
  });

  it("answers a clean 500, not a thrown error, when the bundle cannot be built after the share opened", async () => {
    openShare.mockResolvedValue({ kind: "ok", record: OK_RECORD });
    buildBundle.mockImplementation(() => {
      throw new Error("mapping");
    });
    const res = await call({});
    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({ error: "unavailable" });
  });

  it("refuses an oversized body without reading it into the share door", async () => {
    const res = await call({ recipient: "x".repeat(5000) });
    expect(res.status).toBe(413);
    expect(openShare).not.toHaveBeenCalled();
  });
});
