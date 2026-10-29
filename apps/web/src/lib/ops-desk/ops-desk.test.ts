import { describe, expect, it } from "@jest/globals";
import { callSheetSchema, overviewSchema, parseWindowLines, toE164ForTestCall } from "./schemas";
import { opsDeskReadinessText } from "./readiness";

const base = {
  config_version: 1,
  checklist_gates_readiness: false,
  ready: false,
  checklist: [
    { item_key: "backup_power", title: "Backup power", detail: "x", state: "in_place" as const, attested_at: "2026-10-16T10:00:00Z", attested_by_name: "A", evidence_note: "n".repeat(20), stale: false },
    { item_key: "deputy_cover", title: "Deputy cover", detail: "x", state: "not_attested" as const, attested_at: null, attested_by_name: null, evidence_note: null, stale: false },
  ],
  active_primary: 1,
  active_deputy: 1,
  on_duty_now: 1,
  uncovered_hours_next_7_days: 0,
  window_days: 30,
  assignments: 0,
  acknowledged: 0,
  moved_to_deputy: 0,
  median_seconds_to_acknowledge: null,
  calls_logged: 0,
  calls_answered: 0,
  open_uncovered_incidents: 0,
};

describe("parseWindowLines", () => {
  it("reads one window per line and pads single-digit hours", () => {
    expect(parseWindowLines("1 8:00-18:00\n7 22:00-23:59\n")).toEqual([
      { day: 1, start: "08:00", end: "18:00" },
      { day: 7, start: "22:00", end: "23:59" },
    ]);
  });
  it("allows 24:00 and the 24 hour shortcuts, so midnight is never a gap", () => {
    expect(parseWindowLines("2 00:00-24:00")).toEqual([{ day: 2, start: "00:00", end: "24:00" }]);
    expect(parseWindowLines("3 24h")).toEqual([{ day: 3, start: "00:00", end: "24:00" }]);
    expect(parseWindowLines("all 24h")).toHaveLength(7);
    expect(parseWindowLines("1 18:00-00:00")).toEqual([{ day: 1, start: "18:00", end: "24:00" }]);
  });
  it("splits a night across the two days, wrapping Sunday to Monday", () => {
    expect(parseWindowLines("1 22:00-06:00")).toEqual([
      { day: 1, start: "22:00", end: "24:00" },
      { day: 2, start: "00:00", end: "06:00" },
    ]);
    expect(parseWindowLines("7 20:00-08:00")).toEqual([
      { day: 7, start: "20:00", end: "24:00" },
      { day: 1, start: "00:00", end: "08:00" },
    ]);
  });
  it("refuses 25:00, a missing end and a start of 24:00", () => {
    expect(() => parseWindowLines("1 08:00-25:00")).toThrow(/not a window/);
    expect(() => parseWindowLines("1 24:00-24:00")).toThrow(/not a window/);
    expect(() => parseWindowLines("1 08:00")).toThrow(/not a window/);
  });
  it("refuses a line that is not a window, naming it", () => {
    expect(() => parseWindowLines("Monday 8 to 6")).toThrow(/not a window/);
    try {
      parseWindowLines("Monday 8 to 6");
    } catch (e) {
      // the form action only shows the sentence for a 22023 error
      expect((e as { code?: string }).code).toBe("22023");
    }
    expect(() => parseWindowLines("8 08:00-18:00")).toThrow(/not a window/);
  });
  it("accepts no windows at all (the database then refuses an active contact)", () => {
    expect(parseWindowLines("")).toEqual([]);
  });
});

describe("overview and call sheet schemas", () => {
  it("parses the overview", () => {
    expect(overviewSchema.safeParse(base).success).toBe(true);
  });
  it("refuses an overview with a missing count rather than guessing", () => {
    const { calls_logged: _calls, ...rest } = base;
    void _calls;
    expect(overviewSchema.safeParse(rest).success).toBe(false);
  });
  it("carries no patient field on the call sheet", () => {
    const sheet = callSheetSchema.parse({
      incident_id: "11111111-1111-4111-8111-111111111111",
      reference: "INC-2026-0001",
      opened_at: "2026-10-16T10:00:00Z",
      people: [{ kind: "on_call_primary", profile_id: "22222222-2222-4222-8222-222222222222", name: "Dr A", phone: null, phone_status: "no_confirmed_number", patient_id: "x" }],
    });
    expect(JSON.stringify(sheet)).not.toMatch(/patient/);
  });
});

describe("opsDeskReadinessText", () => {
  it("is red with nobody named", () => {
    expect(opsDeskReadinessText({ ...base, active_primary: 0, active_deputy: 0, on_duty_now: 0 }).tone).toBe("red");
  });
  it("is amber when nobody is on duty now", () => {
    expect(opsDeskReadinessText({ ...base, on_duty_now: 0 }).tone).toBe("amber");
  });
  it("is amber until every check is attested, and never green on a stale one", () => {
    expect(opsDeskReadinessText(base).tone).toBe("amber");
    const done = { ...base, checklist: base.checklist.map((i) => ({ ...i, state: "in_place" as const, stale: false })) };
    expect(opsDeskReadinessText(done).tone).toBe("green");
    const stale = { ...done, checklist: done.checklist.map((i) => ({ ...i, stale: true })) };
    expect(opsDeskReadinessText(stale).tone).toBe("amber");
  });
});

describe("toE164ForTestCall", () => {
  it("accepts a +country number, with spaces or dashes removed", () => {
    expect(toE164ForTestCall("+234 806 119 7940")).toBe("+2348061197940");
    expect(toE164ForTestCall("+44 7700-900123")).toBe("+447700900123");
  });
  it("turns a Nigerian 0 number into +234", () => {
    expect(toE164ForTestCall("08061197940")).toBe("+2348061197940");
  });
  it("refuses anything else", () => {
    for (const bad of ["", "8061197940", "0806119794", "+0123456789", "phone", "+23480611979401234567"]) expect(toE164ForTestCall(bad)).toBeNull();
  });
});
