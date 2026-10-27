import { en } from "@tarragon/i18n";
import { flagLabel, formatResultValue, latestLabel, loadBiomarkerList, loadBiomarkerTrend, parseBiomarkerList, readingsLabel, trendSummary } from "./biomarkers";

let mockUser: string | null = "user-1";
let mockError: { code?: string; message: string } | null = null;
let mockBadShape = false;
const mockCalls: { fn: string; args: unknown }[] = [];

jest.mock("./supabase", () => ({
  supabase: {
    auth: { getSession: async () => ({ data: { session: mockUser ? { user: { id: mockUser } } : null } }) },
    rpc: async (fn: string, args: unknown) => {
      mockCalls.push({ fn, args });
      if (mockError) return { data: null, error: mockError };
      if (mockBadShape) return { data: null, error: null };
      if (fn === "patient_biomarker_list") return { data: [{ code: "hba1c", readings: 3, last_at: "2026-09-01T10:00:00Z", latest_value: 6.1, latest_unit: "%" }], error: null };
      return {
        data: {
          code: "hba1c",
          unit_mixed: false,
          target: { set_by: "care_team", min: null, max: 7, condition: "diabetes" },
          points: [
            { taken_at: "2024-03-01T10:00:00Z", value: 7.2, unit: "%", ref_low: 4, ref_high: 5.6, flag: "high", source: "lab_result", laboratory: "Synlab" },
            { taken_at: "2026-09-01T10:00:00Z", value: 6.1, unit: "%", ref_low: 4, ref_high: 5.6, flag: "high", source: "lab_result", laboratory: null },
          ],
        },
        error: null,
      };
    },
  },
}));

beforeEach(() => {
  mockUser = "user-1";
  mockError = null;
  mockBadShape = false;
  mockCalls.length = 0;
});

describe("results over time on the phone (S43m)", () => {
  it("keeps only well-formed list rows", () => {
    expect(parseBiomarkerList([{ code: "ldl", readings: "2", last_at: "2026-01-01T00:00:00Z", latest_value: "3.1", latest_unit: " " }, { code: 5 }, null])).toEqual([
      { code: "ldl", readings: 2, lastAt: "2026-01-01T00:00:00Z", latestValue: 3.1, latestUnit: null },
    ]);
    expect(parseBiomarkerList("nope")).toEqual([]);
  });

  it("asks for the person's own list and trend by their id, through the database functions that apply the release rules", async () => {
    const list = await loadBiomarkerList("user-1", true);
    expect(list.ok && list.data[0].code).toBe("hba1c");
    const trend = await loadBiomarkerTrend("user-1", "hba1c", true);
    expect(trend.ok && trend.data?.points).toHaveLength(2);
    expect(mockCalls).toEqual([
      { fn: "patient_biomarker_list", args: { p_patient: "user-1" } },
      { fn: "patient_biomarker_trend", args: { p_code: "hba1c", p_patient: "user-1" } },
    ]);
  });

  it("keeps only a care team target, as the shared parser decides", async () => {
    const trend = await loadBiomarkerTrend("user-1", "hba1c", true);
    expect(trend.ok && trend.data?.target).toEqual({ min: null, max: 7, condition: "diabetes" });
  });

  it("offline: the list and an already opened test come from the saved copy, a test never opened says so", async () => {
    await loadBiomarkerList("user-1", true);
    await loadBiomarkerTrend("user-1", "hba1c", true);
    mockError = { message: "Network request failed" };
    const list = await loadBiomarkerList("user-1", true);
    expect(list.ok && list.stale && list.offline).toBe(true);
    const seen = await loadBiomarkerTrend("user-1", "hba1c", true);
    expect(seen.ok && seen.stale).toBe(true);
    expect(await loadBiomarkerTrend("user-1", "ldl", true)).toEqual({ ok: false, offline: true, refused: false });
  });

  it("a supporter's results are read live and never kept", async () => {
    await loadBiomarkerTrend("someone-else", "hba1c", false);
    mockError = { message: "Network request failed" };
    expect(await loadBiomarkerTrend("someone-else", "hba1c", false)).toEqual({ ok: false, offline: true, refused: false });
  });

  it("describes the chart in one sentence for a screen reader, singular and plural", () => {
    expect(trendSummary("hba1c", "%", [{ takenAt: "2024-03-01T10:00:00Z" }, { takenAt: "2026-09-01T10:00:00Z" }])).toBe("HbA1c, 2 results in %, from 2024 to 2026");
    expect(trendSummary("ldl", null, [{ takenAt: "2025-03-01T10:00:00Z" }])).toBe("LDL, 1 result, in 2025");
  });

  it("labels the latest value and the count", () => {
    expect(latestLabel({ latestValue: 6.1, latestUnit: "%" })).toBe("6.1 %");
    expect(latestLabel({ latestValue: null, latestUnit: "%" })).toBeNull();
    expect(readingsLabel(1)).toBe("1 result");
    expect(readingsLabel(4)).toBe("4 results");
  });

  it("treats an answer of the wrong shape as a failed read that keeps the saved copy", async () => {
    await loadBiomarkerList("user-1", true);
    mockBadShape = true;
    const list = await loadBiomarkerList("user-1", true);
    expect(list.ok && list.stale).toBe(true);
    expect(await loadBiomarkerTrend("user-1", "never-opened", true)).toEqual({ ok: false, offline: false, refused: false });
  });

  it("a blank or boolean latest value is no value, not zero", () => {
    expect(parseBiomarkerList([{ code: "a", readings: 1, last_at: "2026-01-01T00:00:00Z", latest_value: "" }, { code: "b", readings: 1, last_at: "2026-01-01T00:00:00Z", latest_value: true }]).map((r) => r.latestValue)).toEqual([null, null]);
  });

  it("prints a result as plain digits, never in exponent form", () => {
    expect(formatResultValue(0.0000001)).toBe("0.0000001");
    expect(formatResultValue(6.1)).toBe("6.1");
    expect(formatResultValue(1200000)).toBe("1200000");
  });

  it("reads the year in Lagos time", () => {
    expect(trendSummary("ldl", null, [{ takenAt: "2025-12-31T23:30:00Z" }])).toBe("LDL, 1 result, in 2026");
  });

  it("drops a list row with no readings or a bad date rather than showing 0 results", () => {
    expect(parseBiomarkerList([{ code: "a", readings: null, last_at: "2026-01-01T00:00:00Z" }, { code: "b", readings: 2, last_at: "garbage" }, { code: "c", readings: "", last_at: "2026-01-01T00:00:00Z" }])).toEqual([]);
  });

  it("gives every flag the database allows words, and never reads an unknown flag as within range", () => {
    for (const f of ["low", "high", "critical", "positive", "negative", "abnormal", "critical_low", "critical_high"]) expect(flagLabel(f)).toBeTruthy();
    expect(flagLabel("normal")).toBeNull();
    expect(flagLabel(null)).toBeNull();
    expect(flagLabel("something_new")).toBe("Outside the laboratory's range");
  });

  it("has a label for every flag and source the database can send", () => {
    for (const f of ["normal", "low", "high", "critical_low", "critical_high"]) expect(Object.hasOwn(en, `biomarkers.flag.${f}`)).toBe(true);
    for (const s of ["lab_result", "legacy_report"]) expect(Object.hasOwn(en, `biomarkers.source.${s}`)).toBe(true);
  });
});
