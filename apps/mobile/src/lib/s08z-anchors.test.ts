/**
 * S08z: dose times anchored to daily events on the phone. The profile (anchor times and "my day has shifted" entries) comes from
 * the mirror plus the outbox, rides on the schedule so every reader resolves the same way, and changes work offline.
 */
import { buildAnchorProfile, anchorProfileFor, mergeRows, pendingToRows, refreshAnchorProfile, setAnchorProfile, __resetAnchorProfilesForTests } from "./anchor-profile";
import { anchorDayHasAnswers, endDayShift, saveAnchorTimes, startDayShift } from "./anchor-actions";
import { loadDoseAnchorConfig } from "./anchor-config";
import { addMedication, buildTodaysDoseChecklist, scheduleOf } from "./medications";
import { parseScheduleSpec } from "@tarragon/medicines";
import { clearLocalMirror, pullChanges } from "./offline-store";
import { __resetOutboxForTests, enqueue, flushOutbox, listOutbox } from "./outbox";
import { MAX_SHIFT_OFFSET, slotsOn } from "@tarragon/medicines";

type Row = Record<string, unknown>;
const mockTables: Record<string, Row[]> = {};
const mockInserts: { table: string; row: Row }[] = [];
const mockRpc = jest.fn(async () => ({ error: null as null | { code?: string; message: string } }));

jest.mock("./api", () => ({
  ...(jest.requireActual("./api") as object),
  postVitalReading: jest.fn().mockResolvedValue({ success: true }),
}));
jest.mock("./dose-reminders", () => ({ replanDoseReminders: jest.fn().mockResolvedValue({ ok: true, planned: 0, pending: 0, allowed: true }) }));
jest.mock("./supabase", () => ({
  supabase: {
    auth: { getSession: async () => ({ data: { session: { user: { id: "user-1" } } } }) },
    rpc: (...args: unknown[]) => (mockRpc as unknown as (...a: unknown[]) => unknown)(...args),
    from: (table: string) => {
      const q: Record<string, unknown> = {
        select: () => q,
        eq: () => q,
        neq: () => q,
        is: () => q,
        gte: () => q,
        lte: () => q,
        or: () => q,
        in: () => q,
        order: () => q,
        limit: () => q,
        single: async () => ({ data: { organisation_id: "org-1" }, error: null }),
        insert: async (row: Row) => {
          mockInserts.push({ table, row });
          return { error: null };
        },
        then: (res: (v: unknown) => unknown) => Promise.resolve({ data: mockTables[table] ?? [], error: null }).then(res),
      };
      return q;
    },
  },
}));

const DEFAULTS = loadDoseAnchorConfig().defaults;
// The patient's own mapping: a stored schedule names an opaque slot, never the anchor (religious belief).
const SLOT = { waking: "s00000000a1", breakfast: "s00000000a3", lunch: "s00000000a5", dinner: "s00000000a8", bedtime: "s00000000b0" } as const;
const SLOT_ROWS = Object.entries(SLOT).map(([anchor, slot]) => ({ slot, anchor }));
const base = { startDate: null, endDate: null, foodNote: null };
const breakfastMed = {
  id: "med-b",
  patient_id: "p1",
  drug_name: "Anchored",
  schedule_times: ["07:30"],
  schedule_spec: { ...base, kind: "daily", times: [], anchored: [{ slot: SLOT.breakfast, offsetMinutes: 0 }] },
  created_at: "2026-09-01T00:00:00Z",
};
const bedtimeMed = {
  id: "med-n",
  patient_id: "p1",
  drug_name: "Night",
  schedule_times: ["23:30"],
  schedule_spec: { ...base, kind: "daily", times: [], anchored: [{ slot: SLOT.bedtime, offsetMinutes: 60 }] },
  created_at: "2026-09-01T00:00:00Z",
};
// Wednesday 7 October 2026, 09:00 Lagos
const NOW = Date.parse("2026-10-07T08:00:00Z");
const TODAY = "2026-10-07";

beforeEach(async () => {
  for (const k of Object.keys(mockTables)) delete mockTables[k];
  mockRpc.mockClear();
  mockInserts.length = 0;
  mockTables.patient_dose_anchor_slots = SLOT_ROWS;
  __resetAnchorProfilesForTests();
  __resetOutboxForTests();
  await clearLocalMirror();
});

describe("building the profile", () => {
  it("reads versions and shifts, ignores rows it cannot read, and lists shifts oldest first", () => {
    const profile = buildAnchorProfile(
      DEFAULTS,
      [
        { anchor: "breakfast", effective_from: "2026-10-01", local_time: "08:00" },
        { anchor: "breakfast", effective_from: "2026-10-10", local_time: "09:00" },
        { anchor: "brunch", effective_from: "2026-10-01", local_time: "10:00" },
        { anchor: "lunch", effective_from: "2026-10-01", local_time: "25:00" },
        { anchor: "dinner", effective_from: "soon", local_time: "19:00" },
      ],
      [
        { id: "b", starts_on: "2026-10-06", ends_on: "2026-10-08", offsets: { dinner: -30, brunch: 5, lunch: Number.NaN }, cancelled_from: null, created_at: "2026-10-02T00:00:00Z" },
        { id: "a", starts_on: "2026-10-05", ends_on: "2026-10-09", offsets: { dinner: 60 }, cancelled_from: "2026-10-08", created_at: "2026-10-01T00:00:00Z" },
        { id: "bad", starts_on: "x", ends_on: "2026-10-09", offsets: { dinner: 60 }, cancelled_from: null, created_at: "2026-10-03T00:00:00Z" },
      ]
    );
    expect(profile.times.breakfast).toHaveLength(2);
    expect((profile.times as Record<string, unknown>).brunch).toBeUndefined();
    expect(profile.times.lunch).toBeUndefined();
    expect(profile.times.dinner).toBeUndefined();
    expect(profile.shifts.map((s) => s.offsets)).toEqual([{ dinner: 60 }, { dinner: -30 }]);
    expect(profile.shifts[0]?.cancelledFrom).toBe("2026-10-08");
  });

  it("merges what is waiting in the outbox on top of the server's rows", () => {
    const pending = pendingToRows([
      { kind: "anchor_times", clientId: "c1", createdAt: "2026-10-07T07:00:00Z", payload: { times: { breakfast: "08:30" }, effective_from: "2026-10-07" } },
      { kind: "day_shift", clientId: "c2", createdAt: "2026-10-07T07:01:00Z", payload: { starts_on: "2026-10-08", ends_on: "2026-10-12", offsets: { dinner: 60 } } },
      { kind: "day_shift_end", clientId: "c3", createdAt: "2026-10-07T07:02:00Z", payload: { shift_id: "s1", cancelled_from: "2026-10-08" } },
      { kind: "vital", clientId: "c4", createdAt: "2026-10-07T07:03:00Z", payload: {} },
    ]);
    const merged = mergeRows(
      [{ anchor: "breakfast", effective_from: "2026-10-07", local_time: "07:00" }],
      [
        { id: "s1", starts_on: "2026-10-05", ends_on: "2026-10-20", offsets: { lunch: 30 }, cancelled_from: null, created_at: "2026-10-04T00:00:00Z" },
        { id: "s2", starts_on: "2026-10-05", ends_on: "2026-10-20", offsets: { lunch: 30 }, cancelled_from: "2026-10-09", created_at: "2026-10-04T00:00:00Z" },
      ],
      pending
    );
    // The same anchor and date: the waiting change, which is newer, wins.
    expect(merged.times).toEqual([{ anchor: "breakfast", effective_from: "2026-10-07", local_time: "08:30" }]);
    expect(merged.shifts.map((s) => [s.id, s.cancelled_from])).toEqual([
      ["s1", "2026-10-08"],
      // An end that names another shift does not touch this one, and an earlier end is never moved later.
      ["s2", "2026-10-09"],
      ["c2", null],
    ]);
  });
});

describe("the Today list resolves anchored doses", () => {
  it("shows an anchored dose at the patient's time, says which anchor it is, and falls back to the proposed time when none is set", () => {
    // The patient has a slot for breakfast but has never set its time: the proposed starting time applies.
    setAnchorProfile("p1", buildAnchorProfile(DEFAULTS, [], [], SLOT_ROWS));
    const withDefault = buildTodaysDoseChecklist([breakfastMed], [], NOW, "p1");
    expect(withDefault.map((i) => `${i.date} ${i.time}`)).toEqual([`${TODAY} ${DEFAULTS.breakfast}`]);
    expect(withDefault[0]?.anchored).toEqual({ anchor: "breakfast", offsetMinutes: 0 });

    setAnchorProfile("p1", buildAnchorProfile(DEFAULTS, [{ anchor: "breakfast", effective_from: "2026-01-01", local_time: "08:15" }], [], SLOT_ROWS));
    expect(buildTodaysDoseChecklist([breakfastMed], [], NOW, "p1").map((i) => i.time)).toEqual(["08:15"]);
  });

  it("a day shift moves the time and the schedule itself is untouched", () => {
    setAnchorProfile("p1", buildAnchorProfile(DEFAULTS, [{ anchor: "breakfast", effective_from: "2026-01-01", local_time: "08:00" }], [
      { id: "s", starts_on: TODAY, ends_on: TODAY, offsets: { breakfast: 120 }, cancelled_from: null, created_at: "2026-10-01T00:00:00Z" },
    ], SLOT_ROWS));
    const [item] = buildTodaysDoseChecklist([breakfastMed], [], NOW, "p1");
    expect(item?.time).toBe("10:00");
    expect(scheduleOf(breakfastMed, "p1").anchored).toEqual([{ slot: SLOT.breakfast, offsetMinutes: 0 }]);
    // The next day is back to normal with no action.
    expect(slotsOn(scheduleOf(breakfastMed, "p1"), "2026-10-08").map((s) => s.time)).toEqual(["08:00"]);
  });

  it("a bedtime dose that crosses midnight is listed on the date it lands on", () => {
    setAnchorProfile("p1", buildAnchorProfile(DEFAULTS, [{ anchor: "bedtime", effective_from: "2026-01-01", local_time: "23:30" }], [], SLOT_ROWS));
    // 00:20 on the 7th (Lagos): last night's 23:30 + 60 minutes is 00:30 today, still to come.
    const at0020 = Date.parse("2026-10-06T23:20:00Z");
    const items = buildTodaysDoseChecklist([bedtimeMed], [], at0020, "p1");
    // Tonight's bedtime dose lands on the 8th at 00:30, so it is listed then, like any dose at 00:30.
    expect(items.map((i) => `${i.date} ${i.time}`)).toEqual(["2026-10-07 00:30"]);
    // Answering it logs against the date and time it landed on.
    expect(items[0]?.dueAtMs).toBe(Date.parse("2026-10-06T23:30:00Z"));
  });

  it("with the patient's slot mapping not read, an anchored dose is not shown at all (it is never guessed)", () => {
    expect(buildTodaysDoseChecklist([breakfastMed], [], NOW, "p1")).toEqual([]);
  });

  it("another person's profile is never used", () => {
    setAnchorProfile("p1", buildAnchorProfile(DEFAULTS, [], [], SLOT_ROWS));
    setAnchorProfile("p2", buildAnchorProfile(DEFAULTS, [{ anchor: "breakfast", effective_from: "2026-01-01", local_time: "05:00" }], [], SLOT_ROWS));
    expect(buildTodaysDoseChecklist([breakfastMed], [], NOW, "p1").map((i) => i.time)).toEqual([DEFAULTS.breakfast]);
    expect(anchorProfileFor(null).times).toEqual({});
  });
});

describe("pulling and refreshing the profile", () => {
  it("mirrors the server's rows, merges the outbox, and a failed read keeps the defaults", async () => {
    mockTables.patient_dose_anchors = [{ anchor: "lunch", effective_from: "2026-01-01", local_time: "12:10" }];
    mockTables.patient_day_shifts = [{ id: "s1", starts_on: TODAY, ends_on: TODAY, offsets: { lunch: 30 }, cancelled_from: null, created_at: "2026-10-01T00:00:00Z" }];
    await pullChanges("p1");
    await enqueue({ kind: "anchor_times", subjectId: "p1", payload: { times: { dinner: "19:40" }, effective_from: TODAY } });
    const profile = await refreshAnchorProfile("p1");
    expect(profile.times.lunch?.[0]?.time).toBe("12:10");
    expect(profile.times.dinner?.[0]).toEqual({ effectiveFrom: TODAY, time: "19:40" });
    expect(profile.shifts).toHaveLength(1);
    expect(anchorProfileFor("p1")).toBe(profile);
  });

  it("an offline phone with nothing pulled yet resolves with the proposed defaults", async () => {
    const profile = await refreshAnchorProfile("never-pulled");
    expect(profile.times).toEqual({});
    expect(profile.defaults.breakfast).toBe(DEFAULTS.breakfast);
  });
});

describe("changing the anchors offline", () => {
  beforeEach(async () => {
    mockTables.medications = [breakfastMed];
    await pullChanges("p1");
  });

  it("saves a time at once: queued, applied on the phone, starting today when nothing is answered", async () => {
    const r = await saveAnchorTimes("p1", { breakfast: "08:45" }, NOW);
    expect(r).toEqual({ ok: true, effectiveFrom: TODAY, startsTomorrow: false });
    const [row] = await listOutbox("anchor_times");
    expect(row?.payload).toEqual({ times: { breakfast: "08:45" }, effective_from: TODAY });
    expect(anchorProfileFor("p1").times.breakfast?.[0]).toEqual({ effectiveFrom: TODAY, time: "08:45" });
  });

  it("starts tomorrow when today already has an answer on an anchored dose, so that answer keeps its slot", async () => {
    mockTables.medication_logs = [{ id: "l1", created_at: "2026-10-07T06:40:00Z", patient_id: "p1", medication_id: "med-b", scheduled_for_date: TODAY, scheduled_time: "07:30", status: "taken" }];
    await pullChanges("p1");
    expect(await anchorDayHasAnswers("p1", ["breakfast"], TODAY)).toBe(true);
    expect(await anchorDayHasAnswers("p1", ["dinner"], TODAY)).toBe(false);
    const r = await saveAnchorTimes("p1", { breakfast: "09:00" }, NOW);
    expect(r).toEqual({ ok: true, effectiveFrom: "2026-10-08", startsTomorrow: true });
  });

  it("counts a dose logged on this phone and not yet sent as an answer too", async () => {
    await enqueue({
      kind: "dose",
      subjectId: "p1",
      payload: { medication_id: "med-b", scheduled_time: "07:30", scheduled_for_date: TODAY, status: "taken", organisation_id: "org-1" },
    });
    expect(await anchorDayHasAnswers("p1", ["breakfast"], TODAY)).toBe(true);
    expect((await saveAnchorTimes("p1", { breakfast: "09:00" }, NOW)).ok && true).toBe(true);
  });

  it("refuses a bad time and an empty save, and a time that would overlap a window", async () => {
    expect(await saveAnchorTimes("p1", { breakfast: "8am" }, NOW)).toEqual({ ok: false, error: "bad_time" });
    expect(await saveAnchorTimes("p1", {}, NOW)).toEqual({ ok: false, error: "bad_time" });
    expect(await saveAnchorTimes("p1", { brunch: "08:00" } as never, NOW)).toEqual({ ok: false, error: "bad_time" });
    mockTables.medications = [
      { ...breakfastMed, id: "med-w", schedule_spec: { ...base, kind: "daily", times: [], windowMinutes: 45, anchored: [{ slot: SLOT.waking, offsetMinutes: 0 }, { slot: SLOT.breakfast, offsetMinutes: 0 }] } },
    ];
    await pullChanges("p1");
    // Waking is at its proposed time; moving breakfast to ten minutes after it is inside a 45 minute window.
    const [h, m] = DEFAULTS.waking.split(":").map(Number);
    const close = `${String(h).padStart(2, "0")}:${String((m ?? 0) + 10).padStart(2, "0")}`;
    expect(await saveAnchorTimes("p1", { breakfast: close }, NOW)).toEqual({ ok: false, error: "window_overlap" });
    expect(await listOutbox("anchor_times")).toHaveLength(0);
  });

  it("sends a queued anchor change, a shift and its end through the database functions, once each", async () => {
    await saveAnchorTimes("p1", { breakfast: "08:45" }, NOW);
    const shift = await startDayShift("p1", { startsOn: TODAY, endsOn: "2026-11-05", offsets: { dinner: 60 } }, NOW);
    expect(shift).toEqual({ ok: true, startsOn: TODAY, endsOn: "2026-11-05", startsTomorrow: false });
    await enqueue({ kind: "day_shift_end", subjectId: "p1", payload: { shift_id: "srv-1", cancelled_from: TODAY } });
    // A flush that was already running (started by the change itself) does not see rows queued after it began; the next one does.
    await flushOutbox();
    await flushOutbox();
    const calls = mockRpc.mock.calls as unknown as [string, Record<string, unknown>][];
    const byName = (n: string) => calls.filter((c) => c[0] === n);
    expect(byName("save_dose_anchor_times")[0]?.[1]).toEqual({ p_patient: "p1", p_times: { breakfast: "08:45" }, p_effective_from: TODAY });
    const create = byName("create_day_shift")[0]?.[1] as Record<string, unknown>;
    expect(create).toMatchObject({ p_patient: "p1", p_starts_on: TODAY, p_ends_on: "2026-11-05", p_offsets: { dinner: 60 } });
    // The row's own client id is what makes a retry safe.
    expect(typeof create.p_client_id).toBe("string");
    expect(byName("cancel_day_shift")[0]?.[1]).toEqual({ p_patient: "p1", p_id: "srv-1" });
    expect(await listOutbox()).toHaveLength(0);
  });

  it("a refused change is kept and reported, never lost", async () => {
    mockRpc.mockResolvedValueOnce({ error: { code: "22023", message: "bad day shift" } });
    await startDayShift("p1", { startsOn: TODAY, endsOn: TODAY, offsets: { dinner: 60 } }, NOW);
    const result = await flushOutbox();
    expect(result.newlyRejected).toBe(1);
    expect((await listOutbox("day_shift"))[0]?.state).toBe("rejected");
  });
});

describe("shifting the day", () => {
  it("refuses a shift with nothing to move, bad dates, or one that is too long", async () => {
    expect(await startDayShift("p1", { startsOn: TODAY, endsOn: "2026-10-20", offsets: { dinner: 0 } }, NOW)).toEqual({ ok: false, error: "offsets" });
    expect(await startDayShift("p1", { startsOn: TODAY, endsOn: "2026-10-01", offsets: { dinner: 30 } }, NOW)).toEqual({ ok: false, error: "dates" });
    expect(await startDayShift("p1", { startsOn: TODAY, endsOn: "2027-06-01", offsets: { dinner: 30 } }, NOW)).toEqual({ ok: false, error: "dates" });
    expect(await listOutbox("day_shift")).toHaveLength(0);
  });

  it("starts tomorrow when today already has answers on the shifted anchor", async () => {
    mockTables.medications = [breakfastMed];
    mockTables.medication_logs = [{ id: "l1", created_at: "2026-10-07T06:40:00Z", patient_id: "p1", medication_id: "med-b", scheduled_for_date: TODAY, scheduled_time: "07:30", status: "taken" }];
    await pullChanges("p1");
    const r = await startDayShift("p1", { startsOn: TODAY, endsOn: "2026-10-12", offsets: { breakfast: 90 } }, NOW);
    expect(r).toEqual({ ok: true, startsOn: "2026-10-08", endsOn: "2026-10-12", startsTomorrow: true });
    // Today keeps its time; tomorrow is shifted.
    const spec = scheduleOf(breakfastMed, "p1");
    expect(slotsOn(spec, TODAY).map((s) => s.time)).toEqual([DEFAULTS.breakfast]);
    expect(slotsOn(spec, "2026-10-08")[0]?.time).not.toBe(DEFAULTS.breakfast);
  });

  it("ending a shift that is still only on this phone simply takes it back", async () => {
    await startDayShift("p1", { startsOn: "2026-10-09", endsOn: "2026-10-12", offsets: { dinner: 60 } }, NOW);
    const [queued] = await listOutbox("day_shift");
    const ended = await endDayShift(
      "p1",
      { id: queued!.clientId, starts_on: "2026-10-09", ends_on: "2026-10-12", offsets: { dinner: 60 }, cancelled_from: null, created_at: queued!.createdAt },
      NOW
    );
    expect(ended.ok).toBe(true);
    expect(await listOutbox("day_shift")).toHaveLength(0);
    expect(await listOutbox("day_shift_end")).toHaveLength(0);
  });

  it("ending a shift the server holds queues an end from today, never before the shift began, and the profile reflects it at once", async () => {
    mockTables.patient_day_shifts = [{ id: "srv-1", starts_on: "2026-10-05", ends_on: "2026-10-20", offsets: { dinner: 60 }, cancelled_from: null, created_at: "2026-10-01T00:00:00Z" }];
    await pullChanges("p1");
    const ended = await endDayShift(
      "p1",
      { id: "srv-1", starts_on: "2026-10-05", ends_on: "2026-10-20", offsets: { dinner: 60 }, cancelled_from: null, created_at: "2026-10-01T00:00:00Z" },
      NOW
    );
    expect(ended.ok).toBe(true);
    const [row] = await listOutbox("day_shift_end");
    expect(row?.payload).toEqual({ shift_id: "srv-1", cancelled_from: TODAY });
    const spec = scheduleOf({ ...breakfastMed, schedule_spec: { ...base, kind: "daily", times: [], anchored: [{ slot: SLOT.dinner, offsetMinutes: 0 }] } }, "p1");
    // Days already lived keep the shifted time; today and later are back to normal.
    expect(slotsOn(spec, "2026-10-06")[0]?.time).not.toBe(DEFAULTS.dinner);
    expect(slotsOn(spec, TODAY)[0]?.time).toBe(DEFAULTS.dinner);
  });

  it("with nobody signed in a change cannot be queued, and says so", async () => {
    const { supabase } = jest.requireMock("./supabase") as { supabase: { auth: { getSession: () => Promise<unknown> } } };
    const spy = jest.spyOn(supabase.auth, "getSession").mockResolvedValue({ data: { session: null } });
    expect(await saveAnchorTimes("p1", { breakfast: "08:45" }, NOW)).toEqual({ ok: false, error: "not_signed_in" });
    expect(await startDayShift("p1", { startsOn: TODAY, endsOn: "2026-10-12", offsets: { dinner: 60 } }, NOW)).toEqual({ ok: false, error: "not_signed_in" });
    expect(await endDayShift("p1", { id: "x", starts_on: TODAY, ends_on: "2026-10-12", offsets: { dinner: 60 }, cancelled_from: null, created_at: "2026-10-01T00:00:00Z" }, NOW)).toEqual({ ok: false });
    spy.mockRestore();
  });
});

describe("adding a medicine tied to the day", () => {
  it("stores the anchors in the spec, never the runtime profile, and lists the normal times for older readers", async () => {
    setAnchorProfile("p1", buildAnchorProfile(DEFAULTS, [{ anchor: "breakfast", effective_from: "2026-01-01", local_time: "08:15" }], [], SLOT_ROWS));
    const parsed = parseScheduleSpec(
      { kind: "daily", times: ["21:00"], anchored: [{ slot: SLOT.breakfast, offsetMinutes: 0 }], startDate: null, endDate: null, foodNote: null, windowMinutes: 0 },
      anchorProfileFor("p1")
    );
    if (!parsed.ok) throw new Error("fixture");
    expect(await addMedication("p1", { drugName: "Anchored", scheduleTimes: [], scheduleSpec: parsed.spec, startedBySpecialist: false })).toMatchObject({});
    const [{ row }] = mockInserts.filter((i) => i.table === "medications");
    expect(row.schedule_times).toEqual(["08:15", "21:00"]);
    expect(row.schedule_spec).toMatchObject({ kind: "daily", times: ["21:00"], anchored: [{ slot: SLOT.breakfast, offsetMinutes: 0 }] });
    expect(JSON.stringify(row.schedule_spec)).not.toContain("anchorProfile");
  });
});

describe("the configured values", () => {
  it("load as whole numbers and times, with the offsets the phone offers", () => {
    const c = loadDoseAnchorConfig();
    expect(Object.keys(c.defaults)).toHaveLength(10);
    expect(c.offsetChoices).toContain(0);
    expect(c.shiftOffsetChoices).toContain(0);
    expect(c.maxShiftDays).toBeGreaterThan(0);
    // The structural bound in the package, the registry and the database are one number.
    expect(c.maxShiftOffsetMinutes).toBe(MAX_SHIFT_OFFSET);
  });

  it("still load on a phone whose clock runs behind the date the values took effect", () => {
    jest.useFakeTimers({ now: new Date("2026-01-01T00:00:00Z"), doNotFake: ["nextTick", "setImmediate", "setTimeout", "setInterval", "queueMicrotask"] });
    try {
      expect(() => loadDoseAnchorConfig()).not.toThrow();
    } finally {
      jest.useRealTimers();
    }
  });
});

describe("staying in step with the server", () => {
  it("reads the anchors back once a change has been sent, so the phone shows what the server holds (including the date it chose)", async () => {
    mockTables.medications = [breakfastMed];
    await pullChanges("p1");
    // The server stores the change from tomorrow, not today.
    mockRpc.mockImplementationOnce(async () => {
      mockTables.patient_dose_anchors = [{ anchor: "breakfast", effective_from: "2026-10-08", local_time: "09:00" }];
      return { error: null };
    });
    await saveAnchorTimes("p1", { breakfast: "09:00" }, NOW);
    await flushOutbox();
    expect(await listOutbox("anchor_times")).toHaveLength(0);
    const profile = await refreshAnchorProfile("p1");
    expect(profile.times.breakfast).toEqual([{ effectiveFrom: "2026-10-08", time: "09:00" }]);
    const spec = scheduleOf(breakfastMed, "p1");
    expect(slotsOn(spec, TODAY).map((x) => x.time)).toEqual([DEFAULTS.breakfast]);
    expect(slotsOn(spec, "2026-10-08").map((x) => x.time)).toEqual(["09:00"]);
  });

  it("a change the server refused is kept for the patient but is not applied", async () => {
    mockRpc.mockResolvedValueOnce({ error: { code: "23514", message: "this time would make a dose window overlap the next dose" } });
    await saveAnchorTimes("p1", { breakfast: "09:00" }, NOW);
    expect(anchorProfileFor("p1").times.breakfast).toBeDefined();
    await flushOutbox();
    expect((await listOutbox("anchor_times"))[0]?.state).toBe("rejected");
    const profile = await refreshAnchorProfile("p1");
    expect(profile.times.breakfast).toBeUndefined();
  });

  it("reads a person's anchors from the server the first time, when they were set on another device", async () => {
    mockTables.patient_dose_anchors = [{ anchor: "breakfast", effective_from: "2026-01-01", local_time: "08:20" }];
    const profile = await refreshAnchorProfile("p1");
    expect(profile.times.breakfast?.[0]?.time).toBe("08:20");
  });

  it("judges a pair of anchors together when it checks a window", async () => {
    mockTables.medications = [
      { ...breakfastMed, id: "med-pair", schedule_spec: { ...base, kind: "daily", times: [], windowMinutes: 60, anchored: [{ slot: SLOT.breakfast, offsetMinutes: 0 }, { slot: SLOT.lunch, offsetMinutes: 0 }] } },
    ];
    await pullChanges("p1");
    // Breakfast alone at 13:20 would sit ten minutes from lunch at its proposed time; moved together with lunch it is fine.
    expect(await saveAnchorTimes("p1", { breakfast: "13:20" }, NOW)).toEqual({ ok: false, error: "window_overlap" });
    expect((await saveAnchorTimes("p1", { breakfast: "13:20", lunch: "18:30" }, NOW)).ok).toBe(true);
  });
});
