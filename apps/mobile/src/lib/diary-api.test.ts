/**
 * S07y: the phone's two calls for the paper diary. Only confirmed rows are ever sent; a closed feature (403) is told apart from a dropped connection; a wrong
 * answer is a failure, never a pretend success.
 */
import { emptyDiaryRow } from "@tarragon/shared";
import { postDiaryRead, postDiarySave } from "./diary-api";

const mockFetch = jest.fn();
jest.mock("./api", () => ({
  API_BASE_URL: "https://api.test",
  fetchWithTimeoutAndRetry: (...a: unknown[]) => mockFetch(...a),
}));
let mockSession: { access_token: string } | null = { access_token: "tok" };
jest.mock("./supabase", () => ({ supabase: { auth: { getSession: async () => ({ data: { session: mockSession } }) } } }));

const ROW = emptyDiaryRow("11111111-1111-4111-8111-111111111111", "blood_pressure", { date: "2026-10-18", time: "08:30", systolic: "132", diastolic: "84" });
const json = (status: number, body: unknown) => ({ status, ok: status >= 200 && status < 300, json: async () => body });

beforeEach(() => {
  mockFetch.mockReset();
  mockSession = { access_token: "tok" };
});

describe("postDiarySave", () => {
  it("sends only confirmed rows, with the bearer token and (for a supported person) the beneficiary", async () => {
    mockFetch.mockResolvedValue(json(200, { status: "done", results: [{ key: ROW.key, status: "saved" }], safetyAssessmentFailed: false }));
    const out = await postDiarySave([{ ...ROW, confirmed: false }], "person-9");
    expect(out.ok).toBe(true);
    const [url, init] = mockFetch.mock.calls[0] as [string, { headers: Record<string, string>; body: string }];
    expect(url).toBe("https://api.test/api/mobile/diary/save");
    expect(init.headers.Authorization).toBe("Bearer tok");
    const body = JSON.parse(init.body) as { rows: { confirmed: boolean }[]; beneficiary_profile_id: string };
    expect(body.rows.every((r) => r.confirmed === true)).toBe(true);
    expect(body.beneficiary_profile_id).toBe("person-9");
  });

  it("a 403 'not_open' is 'not switched on', not a network problem", async () => {
    mockFetch.mockResolvedValue(json(403, { status: "not_open" }));
    expect(await postDiarySave([ROW])).toEqual({ ok: false, offline: false, closed: true, denied: false });
  });

  it("a 403 for lost permission to log for that person is NOT reported as 'not switched on'", async () => {
    mockFetch.mockResolvedValue(json(403, { error: "You don't have permission to log this for that person." }));
    expect(await postDiarySave([ROW], "person-9")).toEqual({ ok: false, offline: false, closed: false, denied: true });
  });

  it("a thrown request is offline", async () => {
    mockFetch.mockRejectedValue(new Error("network"));
    expect(await postDiarySave([ROW])).toEqual({ ok: false, offline: true, closed: false, denied: false });
  });

  it("an answer that is not a finished save is a failure, never a pretend success", async () => {
    mockFetch.mockResolvedValue(json(200, { status: "invalid" }));
    expect(await postDiarySave([ROW])).toEqual({ ok: false, offline: false, closed: false, denied: false });
    mockFetch.mockResolvedValue(json(500, null));
    expect(await postDiarySave([ROW])).toEqual({ ok: false, offline: false, closed: false, denied: false });
  });

  it("no session sends nothing", async () => {
    mockSession = null;
    expect(await postDiarySave([ROW])).toEqual({ ok: false, offline: false, closed: false, denied: false });
    expect(mockFetch).not.toHaveBeenCalled();
  });
});

describe("postDiaryRead", () => {
  const photo = { uri: "file:///p.jpg", mimeType: "image/jpeg", fileName: "p.jpg" };
  it("returns the server's answer", async () => {
    mockFetch.mockResolvedValue(json(200, { status: "unavailable" }));
    expect(await postDiaryRead(photo)).toEqual({ ok: true, answer: { status: "unavailable" } });
  });
  it("a refused file comes back as its reason", async () => {
    mockFetch.mockResolvedValue(json(400, { status: "bad_file", reason: "too_big" }));
    expect(await postDiaryRead(photo)).toEqual({ ok: true, answer: { status: "bad_file", reason: "too_big" } });
  });
  it("a dropped connection is offline", async () => {
    mockFetch.mockRejectedValue(new Error("network"));
    expect(await postDiaryRead(photo)).toEqual({ ok: false, offline: true });
  });
  it("an unreadable answer is a failure", async () => {
    mockFetch.mockResolvedValue({ status: 502, ok: false, json: async () => { throw new Error("html"); } });
    expect(await postDiaryRead(photo)).toEqual({ ok: false, offline: false });
  });
});
