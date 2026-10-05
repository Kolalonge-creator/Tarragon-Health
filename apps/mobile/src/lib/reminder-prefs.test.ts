import { __failNextSet, __reset, __seedRaw } from "../test/mocks/async-storage";
import {
  DEFAULT_PREFS,
  MAX_BP_REMINDERS,
  MAX_TIMES_PER_REMINDER,
  addBpReminder,
  loadReminderPrefs,
  normaliseDraft,
  normaliseTime,
  removeBpReminder,
  sanitizePrefs,
  saveReminderPrefs,
  setBpActive,
  setQuiet,
  updateBpReminder,
} from "./reminder-prefs";

beforeEach(() => __reset());

describe("normaliseTime", () => {
  it("pads and checks", () => {
    expect(normaliseTime("8:05")).toBe("08:05");
    expect(normaliseTime("08:05")).toBe("08:05");
    expect(normaliseTime(" 23:59 ")).toBe("23:59");
  });
  it("refuses what is not a time", () => {
    for (const t of ["24:00", "07:60", "8:5", "8", "ab:cd", "", "08:00:00"]) expect(normaliseTime(t)).toBeNull();
  });
});

describe("normaliseDraft", () => {
  it("sorts times, drops duplicates, and turns all seven days into every day", () => {
    expect(normaliseDraft({ times: ["20:00", "8:00", "08:00"], days: [0, 1, 2, 3, 4, 5, 6] })).toEqual({
      ok: true,
      times: ["08:00", "20:00"],
      days: null,
    });
    expect(normaliseDraft({ times: ["08:00"], days: [3, 1, 1] })).toEqual({ ok: true, times: ["08:00"], days: [1, 3] });
  });
  it("names the problem", () => {
    expect(normaliseDraft({ times: [], days: [1] })).toEqual({ ok: false, error: "no_times" });
    expect(normaliseDraft({ times: ["25:00"], days: [1] })).toEqual({ ok: false, error: "bad_time" });
    expect(normaliseDraft({ times: ["08:00"], days: [] })).toEqual({ ok: false, error: "no_days" });
    expect(normaliseDraft({ times: ["08:00"], days: [7] })).toEqual({ ok: false, error: "bad_days" });
    const five = ["06:00", "08:00", "10:00", "12:00", "14:00"];
    expect(five.length).toBeGreaterThan(MAX_TIMES_PER_REMINDER);
    expect(normaliseDraft({ times: five, days: [1] })).toEqual({ ok: false, error: "too_many_times" });
  });
});

describe("editing", () => {
  const draft = { times: ["08:00"], days: [1, 2] };

  it("adds, updates, switches off and removes a reminder without touching the others", () => {
    const a = addBpReminder(DEFAULT_PREFS, draft, "a");
    if (!a.ok) throw new Error("expected ok");
    const b = addBpReminder(a.prefs, { times: ["20:00"], days: [0] }, "b");
    if (!b.ok) throw new Error("expected ok");
    const edited = updateBpReminder(b.prefs, "a", { times: ["07:30"], days: [1, 2, 3] });
    if (!edited.ok) throw new Error("expected ok");
    expect(edited.prefs.bp.find((r) => r.id === "a")).toMatchObject({ times: ["07:30"], days: [1, 2, 3], active: true });
    expect(edited.prefs.bp.find((r) => r.id === "b")).toMatchObject({ times: ["20:00"] });
    const off = setBpActive(edited.prefs, "b", false);
    expect(off.bp.find((r) => r.id === "b")?.active).toBe(false);
    expect(removeBpReminder(off, "a").bp.map((r) => r.id)).toEqual(["b"]);
  });

  it("refuses an invalid edit and a seventh reminder, leaving the settings as they were", () => {
    expect(addBpReminder(DEFAULT_PREFS, { times: [], days: [1] }, "x")).toEqual({ ok: false, error: "no_times" });
    let prefs = DEFAULT_PREFS;
    for (let i = 0; i < MAX_BP_REMINDERS; i++) {
      const r = addBpReminder(prefs, draft, `r${i}`);
      if (!r.ok) throw new Error("expected ok");
      prefs = r.prefs;
    }
    expect(addBpReminder(prefs, draft, "one-too-many")).toEqual({ ok: false, error: "too_many_reminders" });
  });

  it("keeps the old quiet hours when the new ones are not two different whole hours", () => {
    const set = setQuiet(DEFAULT_PREFS, { startHour: 22, endHour: 7 });
    expect(set.quiet).toEqual({ startHour: 22, endHour: 7 });
    for (const bad of [{ startHour: 5, endHour: 5 }, { startHour: 24, endHour: 7 }, { startHour: 1.5, endHour: 7 }, { startHour: -1, endHour: 7 }]) {
      expect(setQuiet(set, bad).quiet).toEqual({ startHour: 22, endHour: 7 });
    }
    expect(setQuiet(set, null).quiet).toBeNull();
  });

  it("defaults: no quiet hours, no BP reminders, and no medicine setting (medicines are S08's)", () => {
    expect(DEFAULT_PREFS).toEqual({ version: 1, bp: [], quiet: null });
  });
});

describe("sanitizePrefs", () => {
  it("falls back to the defaults for anything unusable", () => {
    for (const bad of [null, undefined, 5, "x", [], {}, { version: 2 }, { version: "1" }]) {
      expect(sanitizePrefs(bad)).toEqual(DEFAULT_PREFS);
    }
    // A future version is not read at all, even if it looks valid.
    expect(sanitizePrefs({ version: 2, bp: [{ id: "a", times: ["08:00"], days: null }] })).toEqual(DEFAULT_PREFS);
    // Right version, wrong shape: keep what is valid (nothing) and the defaults for the rest.
    expect(sanitizePrefs({ version: 1, bp: "no" })).toEqual({ version: 1, bp: [], quiet: null });
  });

  it("drops a reminder that is not valid and keeps the rest", () => {
    const out = sanitizePrefs({
      version: 1,
      doseOn: false, // saved by an earlier build; ignored now
      bp: [
        { id: "ok", times: ["8:00"], days: [1], active: true },
        { id: "", times: ["08:00"], days: null },
        { id: "bad-time", times: ["99:00"], days: null },
        { id: "no-days", times: ["08:00"], days: [] },
        "junk",
      ],
      quiet: { startHour: 22, endHour: 7 },
    });
    expect(out.bp).toEqual([{ id: "ok", times: ["08:00"], days: [1], active: true }]);
    expect(out).toEqual({ version: 1, bp: [{ id: "ok", times: ["08:00"], days: [1], active: true }], quiet: { startHour: 22, endHour: 7 } });
    expect(out).not.toHaveProperty("doseOn");
  });

  it("ignores unusable quiet hours and caps the number of reminders", () => {
    const many = Array.from({ length: 12 }, (_, i) => ({ id: `r${i}`, times: ["08:00"], days: null }));
    const out = sanitizePrefs({ version: 1, bp: many, quiet: { startHour: 3, endHour: 3 } });
    expect(out.bp).toHaveLength(MAX_BP_REMINDERS);
    expect(out.quiet).toBeNull();
  });
});

describe("saving", () => {
  it("round-trips per account and never mixes two accounts", async () => {
    const a = addBpReminder(DEFAULT_PREFS, { times: ["08:00"], days: [1] }, "a");
    if (!a.ok) throw new Error("expected ok");
    expect(await saveReminderPrefs("user-1", a.prefs)).toBe(true);
    expect((await loadReminderPrefs("user-1")).bp).toHaveLength(1);
    expect(await loadReminderPrefs("user-2")).toEqual(DEFAULT_PREFS);
  });

  it("loads the defaults from corrupt saved text instead of throwing", async () => {
    __seedRaw("@tarragon/reminder-prefs/v1:user-1", "{not json");
    expect(await loadReminderPrefs("user-1")).toEqual(DEFAULT_PREFS);
  });

  it("reports a failed save instead of swallowing it", async () => {
    __failNextSet();
    expect(await saveReminderPrefs("user-1", DEFAULT_PREFS)).toBe(false);
  });
});
