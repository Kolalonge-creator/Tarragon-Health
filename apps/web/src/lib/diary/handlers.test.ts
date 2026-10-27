/**
 * The two doors of the paper diary (S07y): both are closed until their go-live guard is open (INV-14), and a closed door stores nothing and calls no model.
 */
jest.mock("server-only", () => ({}));
const readDiaryPage = jest.fn();
jest.mock("./read-diary-page", () => ({ readDiaryPage: (...a: unknown[]) => readDiaryPage(...a) }));
const saveDiaryReadings = jest.fn();
jest.mock("./save-diary-readings", () => {
  const actual = jest.requireActual("./save-diary-readings");
  return { ...actual, saveDiaryReadings: (...a: unknown[]) => saveDiaryReadings(...a) };
});
jest.mock("@/lib/ml/assess-bp-control", () => ({ assessBpControlBestEffort: jest.fn() }));
jest.mock("@/lib/vitals/assess-glucose", () => ({ assessGlucoseBestEffort: jest.fn() }));
jest.mock("@/lib/vitals/assess-heart-rate", () => ({ assessHeartRateBestEffort: jest.fn() }));
jest.mock("@/lib/health-score/assess-health-score", () => ({ assessHealthScoreBestEffort: jest.fn() }));

const rateLimit = jest.fn();
jest.mock("@/lib/rate-limit", () => ({ rateLimit: (...a: unknown[]) => rateLimit(...a) }));

import { diaryLimits, emptyDiaryRow } from "@tarragon/shared";
import { handleDiaryRead, handleDiarySave } from "./handlers";

function client(open: Record<string, boolean>, org: string | null = "o1", config: { diary_window_days: number; future_skew_minutes: number } | null = { diary_window_days: 30, future_skew_minutes: 5 }) {
  return {
    rpc: async (_fn: string, args: { p_key: string }) => ({ data: open[args.p_key] === true, error: null }),
    from: (table: string) => {
      if (table === "offline_sync_config") return { select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: config }) }) }) };
      if (table !== "profiles") throw new Error(`unexpected table ${table}`);
      return { select: () => ({ eq: () => ({ single: async () => ({ data: org ? { organisation_id: org } : null }) }) }) };
    },
  } as never;
}

const file = (size = 100, type = "image/jpeg") => new File([new Uint8Array(size).fill(1)], "page.jpg", { type });
const ROW = { ...emptyDiaryRow("11111111-1111-4111-8111-111111111111", "blood_pressure", { date: "2026-10-18", time: "08:30", systolic: "132", diastolic: "84" }), confirmed: true as const };

beforeEach(() => {
  readDiaryPage.mockReset();
  saveDiaryReadings.mockReset();
  rateLimit.mockReset().mockResolvedValue({ success: true });
});

describe("handleDiaryRead", () => {
  it("is closed while paper_diary_ai_reader is off: not_open, and no model is reached", async () => {
    const out = await handleDiaryRead(client({}), "p1", file());
    expect(out).toEqual({ httpStatus: 200, body: { status: "not_open" } });
    expect(readDiaryPage).not.toHaveBeenCalled();
  });
  it("the entry guard alone does not open the reader (they are separate switches)", async () => {
    const out = await handleDiaryRead(client({ paper_diary_entry: true }), "p1", file());
    expect(out.body).toEqual({ status: "not_open" });
  });
  it("the reader alone is not enough either: a photo of a health diary is not sent to a paid model for a person who cannot save the result", async () => {
    const out = await handleDiaryRead(client({ paper_diary_ai_reader: true }), "p1", file());
    expect(out.body).toEqual({ status: "not_open" });
    expect(readDiaryPage).not.toHaveBeenCalled();
  });
  it("a missing or oversize file is refused before any guard is read (no round trip for a bad request)", async () => {
    const rpc = jest.fn();
    const spy = { rpc, from: () => { throw new Error("no table"); } } as never;
    expect((await handleDiaryRead(spy, "p1", null)).httpStatus).toBe(400);
    expect(rpc).not.toHaveBeenCalled();
  });
  it("with the guard open, a missing file is a 400", async () => {
    const out = await handleDiaryRead(client({ paper_diary_ai_reader: true, paper_diary_entry: true }), "p1", null);
    expect(out.httpStatus).toBe(400);
  });
  it("with the guard open it hands the bytes to the governed reader and returns its answer", async () => {
    readDiaryPage.mockResolvedValue({ status: "unavailable" });
    const out = await handleDiaryRead(client({ paper_diary_ai_reader: true, paper_diary_entry: true }), "p1", file());
    expect(out).toEqual({ httpStatus: 200, body: { status: "unavailable" } });
    expect(readDiaryPage).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ patientId: "p1", mediaType: "image/jpeg" }));
  });
  it("refuses an oversize upload from its declared size, before a byte of it is loaded", async () => {
    const big = { size: diaryLimits().maxPhotoBytes + 1, type: "image/jpeg", arrayBuffer: jest.fn() } as unknown as File;
    const out = await handleDiaryRead(client({ paper_diary_ai_reader: true, paper_diary_entry: true }), "p1", big);
    expect(out).toEqual({ httpStatus: 400, body: { status: "bad_file", reason: "too_big" } });
    expect((big as unknown as { arrayBuffer: jest.Mock }).arrayBuffer).not.toHaveBeenCalled();
    expect(readDiaryPage).not.toHaveBeenCalled();
  });
  it("is limited per person: over the ceiling it answers 429 and never reaches the model", async () => {
    rateLimit.mockResolvedValue({ success: false });
    const out = await handleDiaryRead(client({ paper_diary_ai_reader: true, paper_diary_entry: true }), "p1", file());
    expect(out).toEqual({ httpStatus: 429, body: { status: "rate_limited" } });
    expect(readDiaryPage).not.toHaveBeenCalled();
    expect(rateLimit).toHaveBeenCalledWith("diary-read:user:p1", { limit: diaryLimits().maxReadsPerHour, windowSeconds: 3600 });
  });
  it("a refused file is a 400 with the reason", async () => {
    readDiaryPage.mockResolvedValue({ status: "bad_file", reason: "too_big" });
    const out = await handleDiaryRead(client({ paper_diary_ai_reader: true, paper_diary_entry: true }), "p1", file());
    expect(out).toEqual({ httpStatus: 400, body: { status: "bad_file", reason: "too_big" } });
  });
});

describe("handleDiarySave", () => {
  it("is closed while paper_diary_entry is off: nothing is saved", async () => {
    const out = await handleDiarySave(client({}), { userId: "p1", subjectId: "p1", route: "t" }, { rows: [ROW] });
    expect(out).toEqual({ httpStatus: 403, body: { status: "not_open" } });
    expect(saveDiaryReadings).not.toHaveBeenCalled();
  });
  it("the reader guard alone does not open the typed sheet", async () => {
    const out = await handleDiarySave(client({ paper_diary_ai_reader: true }), { userId: "p1", subjectId: "p1", route: "t" }, { rows: [ROW] });
    expect(out.httpStatus).toBe(403);
  });
  it("refuses a request that is not a list of confirmed rows, before the guard is even read", async () => {
    const out = await handleDiarySave(client({ paper_diary_entry: true }), { userId: "p1", subjectId: "p1", route: "t" }, { rows: [{ ...ROW, confirmed: false }] });
    expect(out.httpStatus).toBe(400);
    expect(saveDiaryReadings).not.toHaveBeenCalled();
  });
  it("saves for the SUBJECT (the person whose account is open), in their own organisation", async () => {
    saveDiaryReadings.mockResolvedValue({ results: [{ key: ROW.key, status: "saved" }], safetyAssessmentFailed: false });
    const out = await handleDiarySave(client({ paper_diary_entry: true }, "org-9"), { userId: "caller-1", subjectId: "subject-7", route: "t" }, { rows: [ROW] });
    expect(out.httpStatus).toBe(200);
    expect(out.body).toMatchObject({ status: "done", results: [{ key: ROW.key, status: "saved" }] });
    expect(saveDiaryReadings).toHaveBeenCalledWith(expect.anything(), { subjectId: "subject-7", organisationId: "org-9", route: "t" }, [ROW], expect.anything());
  });
  it("for someone the caller supports, the database trigger is the only judge of the guard (the caller's own guard answer can differ for a test account)", async () => {
    saveDiaryReadings.mockResolvedValue({ results: [{ key: ROW.key, status: "refused", closed: true }], safetyAssessmentFailed: false });
    const out = await handleDiarySave(client({}), { userId: "caller-1", subjectId: "subject-7", route: "t" }, { rows: [ROW] });
    expect(out.httpStatus).toBe(200);
    expect(saveDiaryReadings).toHaveBeenCalledTimes(1);
  });
  it("judges the rows by the DATABASE's own window, so the check here and the insert trigger cannot disagree", async () => {
    saveDiaryReadings.mockResolvedValue({ results: [], safetyAssessmentFailed: false });
    await handleDiarySave(client({ paper_diary_entry: true }, "o1", { diary_window_days: 7, future_skew_minutes: 2 }), { userId: "p1", subjectId: "p1", route: "t" }, { rows: [ROW] });
    const deps = saveDiaryReadings.mock.calls[0]?.[3] as { limits: { windowDays: number; skewMinutes: number } };
    expect(deps.limits).toMatchObject({ windowDays: 7, skewMinutes: 2 });
  });
  it("falls back to the configured window when the database's cannot be read", async () => {
    saveDiaryReadings.mockResolvedValue({ results: [], safetyAssessmentFailed: false });
    await handleDiarySave(client({ paper_diary_entry: true }, "o1", null), { userId: "p1", subjectId: "p1", route: "t" }, { rows: [ROW] });
    const deps = saveDiaryReadings.mock.calls[0]?.[3] as { limits: { windowDays: number } };
    expect(deps.limits.windowDays).toBe(diaryLimits().windowDays);
  });
  it("no organisation on file is refused", async () => {
    const out = await handleDiarySave(client({ paper_diary_entry: true }, null), { userId: "p1", subjectId: "p1", route: "t" }, { rows: [ROW] });
    expect(out.httpStatus).toBe(400);
  });
});
