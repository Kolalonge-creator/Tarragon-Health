import { describe, expect, it } from "@jest/globals";
import {
  CSV_COLUMNS,
  consultationsLogCsv,
  filtersToQuery,
  lagosTime,
  filtersToRpcArgs,
  parseConsultationsLog,
  parseConsultationsLogFilters,
  totalsOf,
} from "./consultations-log";
import { firstLiveCall } from "./consultations-log.fixture";


describe("consultations log filters", () => {
  it("reads valid filters and keeps tests off unless tests=1", () => {
    const f = parseConsultationsLogFilters({ from: "2026-11-01", to: "2026-11-03", doctor: firstLiveCall.clinician_id!, status: "completed" });
    expect(f).toEqual({ from: "2026-11-01", to: "2026-11-03", doctor: firstLiveCall.clinician_id, status: "completed", includeTests: false });
    expect(parseConsultationsLogFilters({ tests: "1" }).includeTests).toBe(true);
  });

  it("drops a value that does not parse instead of failing the page", () => {
    const f = parseConsultationsLogFilters({ from: "yesterday", doctor: "not-a-uuid", status: "maybe", tests: "yes" });
    expect(f).toEqual({ from: undefined, to: undefined, doctor: undefined, status: undefined, includeTests: false });
  });

  it("round-trips to a query string and to the RPC arguments", () => {
    const f = parseConsultationsLogFilters({ from: "2026-11-03", tests: "1" });
    expect(filtersToQuery(f)).toBe("from=2026-11-03&tests=1");
    expect(filtersToRpcArgs(f)).toEqual({ p_from: "2026-11-03", p_to: null, p_clinician_id: null, p_status: null, p_include_tests: true });
  });
});

describe("consultations log rows", () => {
  it("parses the live shape, numeric strings included, and refuses anything else", () => {
    const rows = parseConsultationsLog([{ ...firstLiveCall, doctor_minutes: "21.7" }]);
    expect(rows?.[0].doctor_minutes).toBe(21.7);
    expect(parseConsultationsLog(null)).toEqual([]);
    expect(parseConsultationsLog([{ encounter_id: "x" }])).toBeNull();
  });

  it("totals doctor and connected minutes, counting a call with no Zoom events as zero", () => {
    expect(totalsOf([firstLiveCall, { ...firstLiveCall, encounter_id: "b", doctor_minutes: null, connected_minutes: null }])).toEqual({
      calls: 2,
      doctorMinutes: 21.7,
      connectedMinutes: 8.7,
    });
  });
});

describe("consultations log CSV", () => {
  it("writes the header and one line per call in Lagos time", () => {
    const [header, line] = consultationsLogCsv([firstLiveCall]).split("\r\n");
    expect(header).toBe(CSV_COLUMNS.join(","));
    expect(line).toBe(
      "2026-11-03,22:00,k boss,ce2bebd5-84d4-448d-8d36-f327c469a921,Kola Longe,c22fc539-23af-46e4-bf73-f799da147f10,completed,,22:05,22:26,21.7,8.7,2,0,5,2,true,c861c6bb-b3e2-4ba8-b8b5-d14e5523e691",
    );
  });

  it("writes a time just after midnight as 00:xx, never 24:xx", () => {
    expect(lagosTime("2026-11-03T23:30:00Z")).toBe("00:30");
  });

  it("neutralises a name a spreadsheet would run as a formula", () => {
    const csv = consultationsLogCsv([{ ...firstLiveCall, patient_name: '=HYPERLINK("x")' }]);
    expect(csv).toContain(`"'=HYPERLINK(""x"")"`);
  });
});
