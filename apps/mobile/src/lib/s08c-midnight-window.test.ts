/**
 * S08c: a dose whose window crosses midnight stays on the Today list, and can be answered, until it
 * closes. 23:00 with a two hour window is still open at 00:30, and the list used to be for the new
 * day only, so the dose could not be logged for up to 90 minutes.
 */
import { buildTodaysDoseChecklist, dosesOn, loadTodaysDoses } from "./medications";
import { enqueue } from "./outbox";
import { clearLocalMirror } from "./offline-store";

type Row = Record<string, unknown>;
const mockTables: Record<string, Row[]> = {};

jest.mock("./api", () => ({
  ...(jest.requireActual("./api") as object),
  postVitalReading: jest.fn().mockResolvedValue({ success: true }),
}));

jest.mock("./supabase", () => ({
  supabase: {
    auth: { getSession: async () => ({ data: { session: { user: { id: "user-1" } } } }) },
    from: (table: string) => {
      const q: Record<string, unknown> = {
        select: () => q,
        eq: () => q,
        is: () => q,
        gte: () => q,
        in: () => q,
        order: () => q,
        limit: () => q,
        single: async () => ({ data: { organisation_id: "org-1" }, error: null }),
        insert: async () => ({ error: null }),
        then: (res: (v: unknown) => unknown) => Promise.resolve({ data: mockTables[table] ?? [], error: null }).then(res),
      };
      return q;
    },
  },
}));

const base = { startDate: null, endDate: null, foodNote: null };
const late = {
  id: "late",
  drug_name: "Night",
  schedule_times: ["23:00"],
  schedule_spec: { ...base, kind: "daily", times: ["23:00"], windowMinutes: 120 },
  created_at: "2026-09-01T00:00:00Z",
};
const plain = { id: "plain", drug_name: "Plain", schedule_times: ["23:00"], schedule_spec: null, created_at: "2026-09-01T00:00:00Z" };

// 00:30 and 01:30 in Lagos on Tuesday 6 October 2026
const AT_0030 = Date.parse("2026-10-05T23:30:00Z");
const AT_0130 = Date.parse("2026-10-06T00:30:00Z");

beforeEach(async () => {
  for (const k of Object.keys(mockTables)) delete mockTables[k];
  await clearLocalMirror();
});

const keys = (items: { date?: string; time: string; medicationId: string }[]) => items.map((i) => `${i.medicationId}@${i.date} ${i.time}`);

describe("yesterday's open dose on today's list", () => {
  it("keeps last night's 23:00 dose with a two hour window until 01:00", () => {
    expect(keys(buildTodaysDoseChecklist([late], [], AT_0030))).toEqual(["late@2026-10-05 23:00", "late@2026-10-06 23:00"]);
    expect(keys(buildTodaysDoseChecklist([late], [], AT_0130))).toEqual(["late@2026-10-06 23:00"]);
  });

  it("does the same for a plain dose inside the global two hour missed window", () => {
    expect(keys(buildTodaysDoseChecklist([plain], [], AT_0030))).toEqual(["plain@2026-10-05 23:00", "plain@2026-10-06 23:00"]);
    expect(buildTodaysDoseChecklist([plain], [], AT_0030)[0].state).toBe("due");
  });

  it("answers yesterday's dose without touching today's, because a log carries its own date", () => {
    const logs = [{ medication_id: "late", scheduled_time: "23:00", status: "taken" as const, scheduled_for_date: "2026-10-05" }];
    const items = buildTodaysDoseChecklist([late], logs, AT_0030);
    expect(items.map((i) => [i.date, i.state])).toEqual([
      ["2026-10-05", "taken"],
      ["2026-10-06", "upcoming"],
    ]);
  });

  it("treats a log with no date as today's, as older callers send", () => {
    const logs = [{ medication_id: "late", scheduled_time: "23:00", status: "taken" as const }];
    expect(buildTodaysDoseChecklist([late], logs, AT_0030).map((i) => [i.date, i.state])).toEqual([
      ["2026-10-05", "due"],
      ["2026-10-06", "taken"],
    ]);
  });

  it("owes nothing from before the medicine was added", () => {
    const added = { ...late, created_at: "2026-10-05T23:15:00Z" }; // added at 00:15, after last night's 23:00
    expect(keys(buildTodaysDoseChecklist([added], [], AT_0030))).toEqual(["late@2026-10-06 23:00"]);
  });

  it("lists yesterday's open dose first", () => {
    const early = { id: "early", drug_name: "E", schedule_times: ["00:00"], schedule_spec: null, created_at: "2026-09-01T00:00:00Z" };
    expect(keys(buildTodaysDoseChecklist([early, late], [], AT_0030))[0]).toBe("late@2026-10-05 23:00");
  });
});

describe("what counts as today's", () => {
  it("leaves last night's open dose out of the today counts but keeps undated items", () => {
    const items = buildTodaysDoseChecklist([late], [], AT_0030);
    expect(dosesOn(items, "2026-10-06").map((i) => i.date)).toEqual(["2026-10-06"]);
    expect(dosesOn([{ medicationId: "x", drugName: "X", time: "08:00", status: "pending" }], "2026-10-06")).toHaveLength(1);
  });
});

describe("loading the list with yesterday's open dose", () => {
  it("reads yesterday's log from the server and from this phone's unsent doses", async () => {
    jest.useFakeTimers({
      now: AT_0030,
      doNotFake: ["nextTick", "setImmediate", "clearImmediate", "setInterval", "clearInterval", "setTimeout", "clearTimeout", "queueMicrotask", "performance", "hrtime"],
    });
    try {
      mockTables.medications = [late];
      mockTables.medication_logs_latest_per_slot = [
        { medication_id: "late", scheduled_for_date: "2026-10-05", scheduled_time: "23:00", status: "taken" },
      ];
      const served = await loadTodaysDoses("p1");
      expect(served.ok && served.data.map((i) => [i.date, i.state])).toEqual([
        ["2026-10-05", "taken"],
        ["2026-10-06", "upcoming"],
      ]);

      // nothing on the server yet, but the answer is waiting on this phone
      mockTables.medication_logs_latest_per_slot = [];
      await enqueue({
        kind: "dose",
        subjectId: "p1",
        payload: { medication_id: "late", scheduled_time: "23:00", scheduled_for_date: "2026-10-05", status: "delayed", organisation_id: "org-1" },
        holdSeconds: 600,
      });
      const pending = await loadTodaysDoses("p1");
      expect(pending.ok && pending.data.map((i) => [i.date, i.state])).toEqual([
        ["2026-10-05", "late"],
        ["2026-10-06", "upcoming"],
      ]);
    } finally {
      jest.useRealTimers();
    }
  });
});
