import { CUFF_READER_COPY, proposalIsStale, interpretCuffResponse, isCuffReaderOpen, requestCuffProposal } from "./cuff-reader";
import { supabase } from "./supabase";
import { draftFromRecognisedText, finalisePhotoReading } from "@tarragon/shared";

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

describe("interpretCuffResponse", () => {
  it("a proposal becomes lines for the existing draft", () => {
    expect(interpretCuffResponse(200, { status: "proposal", lines: ["128", "82", "71"], pulse_dropped: false })).toEqual({ ok: true, lines: ["128", "82", "71"], pulseDropped: false });
  });
  it("a retake request is a retake, never numbers", () => {
    expect(interpretCuffResponse(200, { status: "retake", reason: "implausible" })).toMatchObject({ ok: false, kind: "retake", message: CUFF_READER_COPY.retake });
  });
  it("404 means not switched on; anything else unexpected means unavailable, so the person types", () => {
    expect(interpretCuffResponse(404, { error: "x" })).toMatchObject({ ok: false, kind: "not_open" });
    expect(interpretCuffResponse(200, { status: "unavailable", reason: "kill_switch" })).toMatchObject({ ok: false, kind: "unavailable" });
    expect(interpretCuffResponse(500, null)).toMatchObject({ ok: false, kind: "unavailable" });
  });
  it("refuses a malformed proposal rather than guessing", () => {
    expect(interpretCuffResponse(200, { status: "proposal", lines: ["128"] })).toMatchObject({ ok: false });
    expect(interpretCuffResponse(200, { status: "proposal", lines: [128, 82] })).toMatchObject({ ok: false });
    expect(interpretCuffResponse(200, { status: "proposal" })).toMatchObject({ ok: false });
  });
  it("a proposal still cannot be saved until every number is ticked", () => {
    const r = interpretCuffResponse(200, { status: "proposal", lines: ["128", "82", "71"] });
    if (!r.ok) throw new Error("expected a proposal");
    const draft = draftFromRecognisedText("blood_pressure", r.lines);
    expect(draft.fields.every((f) => f.suggested)).toBe(true);
    expect(finalisePhotoReading({ draft, edits: {}, confirmedFields: [] })).toMatchObject({ ok: false });
  });
  it("the copy tells the person the photo is sent and deleted, in plain words with no em dash", () => {
    expect(CUFF_READER_COPY.consent).toMatch(/sends your photo/);
    expect(CUFF_READER_COPY.consent).toMatch(/deleted/);
    for (const v of Object.values(CUFF_READER_COPY)) expect(v).not.toContain("—");
  });
});

describe("isCuffReaderOpen", () => {
  it("is true only when the guard answers true", async () => {
    rpc.mockResolvedValue({ data: true, error: null });
    expect(await isCuffReaderOpen()).toBe(true);
    expect(rpc).toHaveBeenCalledWith("go_live_guard_is_open", { p_key: "cuff_camera_enabled" });
  });
  it("fails closed on false, an error or a thrown call", async () => {
    rpc.mockResolvedValue({ data: false, error: null });
    expect(await isCuffReaderOpen()).toBe(false);
    rpc.mockResolvedValue({ data: true, error: { message: "x" } });
    expect(await isCuffReaderOpen()).toBe(false);
    rpc.mockRejectedValue(new Error("down"));
    expect(await isCuffReaderOpen()).toBe(false);
  });
});

describe("requestCuffProposal", () => {
  it("sends the photo as multipart with the bearer token to the proposal route only", async () => {
    fetchMock.mockResolvedValue({ status: 200, json: async () => ({ status: "proposal", lines: ["128", "82"] }) });
    const out = await requestCuffProposal("file:///cuff.jpg");
    expect(out).toMatchObject({ ok: true });
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("http://api.test/api/mobile/cuff-display-proposal");
    expect((init.headers as Record<string, string>).Authorization).toBe("Bearer tok");
    expect(init.body).toBeInstanceOf(FormData);
  });
  it("offline gives an offline answer, so the person types", async () => {
    fetchMock.mockRejectedValue(new Error("network"));
    expect(await requestCuffProposal("file:///cuff.jpg")).toMatchObject({ ok: false, kind: "offline" });
  });
  it("sends nothing without a session", async () => {
    getSession.mockResolvedValue({ data: { session: null } });
    expect(await requestCuffProposal("file:///cuff.jpg")).toMatchObject({ ok: false });
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("proposalIsStale", () => {
  it("drops an answer for a photo the person has since replaced", () => {
    expect(proposalIsStale("file:///a.jpg", "file:///b.jpg")).toBe(true);
    expect(proposalIsStale("file:///a.jpg", null)).toBe(true);
    expect(proposalIsStale("file:///a.jpg", "file:///a.jpg")).toBe(false);
  });
});
