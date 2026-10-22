import { isPassportOpen, passportFileName, passportRequestBody, PASSPORT_DEFAULT_ON, PASSPORT_SECTIONS, savePassportCopy } from "./result-passport";
import { supabase } from "./supabase";

jest.mock("./supabase", () => ({ supabase: { rpc: jest.fn(), auth: { getSession: jest.fn() } } }));
jest.mock("./api", () => ({ API_BASE_URL: "http://api.test", fetchWithTimeoutAndRetry: jest.fn() }));
import { fetchWithTimeoutAndRetry } from "./api";

const rpc = supabase.rpc as unknown as jest.Mock;
const getSession = supabase.auth.getSession as unknown as jest.Mock;
const fetchMock = fetchWithTimeoutAndRetry as unknown as jest.Mock;

beforeEach(() => {
  jest.clearAllMocks();
  getSession.mockResolvedValue({ data: { session: { access_token: "tok" } } });
});

describe("pure helpers", () => {
  it("names the copy by the Lagos date, so a late evening copy is dated by the Lagos calendar", () => {
    expect(passportFileName(new Date("2026-10-22T23:30:00Z"))).toBe("result-passport-2026-10-23.pdf");
    expect(passportFileName(new Date("2026-10-22T09:00:00Z"))).toBe("result-passport-2026-10-22.pdf");
  });
  it("sends only known sections, once each", () => {
    expect(passportRequestBody(["bp", "bp", "glucose", "reproductive_health" as never], 90)).toEqual({ days: 90, sections: ["bp", "glucose"] });
  });
  it("offers no reproductive, mental health or sensitive-result section, and defaults to the useful ones", () => {
    expect(PASSPORT_SECTIONS.map((s) => s.id).join(",")).not.toMatch(/reproduct|mental|cycle|pregnan|hiv|hepat/);
    expect([...PASSPORT_DEFAULT_ON]).toEqual(expect.arrayContaining(["medicines", "allergies_conditions", "lab_results"]));
    for (const s of PASSPORT_SECTIONS) expect(s.label).not.toContain("—");
  });
});

describe("isPassportOpen", () => {
  it("fails closed", async () => {
    rpc.mockResolvedValue({ data: true, error: null });
    expect(await isPassportOpen()).toBe(true);
    expect(rpc).toHaveBeenCalledWith("go_live_guard_is_open", { p_key: "result_passport_enabled" });
    rpc.mockResolvedValue({ data: null, error: { message: "x" } });
    expect(await isPassportOpen()).toBe(false);
  });
});

const written: { name: string; bytes: Uint8Array }[] = [];
jest.mock("expo-file-system", () => {
  class Directory {
    exists = false;
    create() {
      this.exists = true;
    }
  }
  class File {
    exists = false;
    uri: string;
    private name: string;
    constructor(_dir: unknown, name: string) {
      this.name = name;
      this.uri = `file:///docs/result-passports/${name}`;
    }
    delete() {}
    create() {}
    write(bytes: Uint8Array) {
      written.push({ name: this.name, bytes });
    }
  }
  return { Directory, File, Paths: { document: "file:///docs" } };
});

const pdf = (text: string) => ({ ok: true, status: 200, arrayBuffer: async () => new TextEncoder().encode(text).buffer });

describe("savePassportCopy", () => {
  beforeEach(() => {
    written.length = 0;
  });
  it("saves a real PDF into the app's own folder under a Lagos-dated name", async () => {
    fetchMock.mockResolvedValue(pdf("%PDF-1.7 fake"));
    const out = await savePassportCopy(["glucose", "lab_results"], 90, new Date("2026-10-22T09:00:00Z"));
    expect(out).toEqual({ ok: true, uri: "file:///docs/result-passports/result-passport-2026-10-22.pdf", name: "result-passport-2026-10-22.pdf" });
    expect(written).toHaveLength(1);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("http://api.test/api/mobile/result-passport/pdf");
    expect(JSON.parse(String(init.body))).toEqual({ days: 90, sections: ["glucose", "lab_results"] });
  });
  it("never saves something that is not a PDF as if it were the passport", async () => {
    fetchMock.mockResolvedValue(pdf("<html>bad gateway</html>"));
    expect(await savePassportCopy(["bp"], 30)).toEqual({ ok: false, kind: "failed" });
    expect(written).toHaveLength(0);
  });
  it("404 is not open, a network failure is offline, nothing is saved either way", async () => {
    fetchMock.mockResolvedValue({ ok: false, status: 404 });
    expect(await savePassportCopy(["bp"], 30)).toEqual({ ok: false, kind: "not_open" });
    fetchMock.mockRejectedValue(new Error("network"));
    expect(await savePassportCopy(["bp"], 30)).toEqual({ ok: false, kind: "offline" });
    expect(written).toHaveLength(0);
  });
  it("asks for no document when no section is chosen", async () => {
    expect(await savePassportCopy([], 30)).toEqual({ ok: false, kind: "failed" });
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
