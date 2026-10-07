/**
 * S08b: flexible dose windows and the catch-up sheet's logic: which doses are asked about, what
 * each answer records, that a dismissal is remembered, and that a window keeps a dose open and
 * adds one gentle follow-up reminder.
 */
import { buildTodaysDoseChecklist, loadCatchUpDoses, statusForTakenAt } from "./medications";
import { answerCatchUp, catchUpKey, loadDismissed, loadLastOffered, mayOfferCatchUp, saveDismissed, saveLastOffered, selectCatchUp, statusForChoice } from "./catch-up";
import { replanDoseReminders } from "./dose-reminders";
import { enqueue } from "./outbox";
import { clearLocalMirror } from "./offline-store";
import { t } from "@tarragon/i18n";

type Row = Record<string, unknown>;
const mockTables: Record<string, Row[]> = {};
const mockInserted: { table: string; row: Row }[] = [];

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
        insert: async (row: Row) => {
          mockInserted.push({ table, row });
          return { error: null };
        },
        then: (res: (v: unknown) => unknown) => Promise.resolve({ data: mockTables[table] ?? [], error: null }).then(res),
      };
      return q;
    },
  },
}));

const scheduled: { identifier: string; content: { title: string; body: string } }[] = [];
jest.mock("expo-notifications", () => ({
  SchedulableTriggerInputTypes: { DATE: "date", TIME_INTERVAL: "timeInterval" },
  AndroidImportance: { HIGH: 4 },
  setNotificationHandler: jest.fn(),
  setNotificationChannelAsync: jest.fn(async () => {}),
  getPermissionsAsync: jest.fn(async () => ({ status: "granted" })),
  requestPermissionsAsync: jest.fn(async () => ({ status: "granted" })),
  getAllScheduledNotificationsAsync: jest.fn(async () => scheduled.map((s) => ({ identifier: s.identifier }))),
  cancelScheduledNotificationAsync: jest.fn(async (id: string) => {
    const i = scheduled.findIndex((s) => s.identifier === id);
    if (i >= 0) scheduled.splice(i, 1);
  }),
  scheduleNotificationAsync: jest.fn(async (req: { identifier?: string; content: { title: string; body: string } }) => {
    scheduled.push({ identifier: req.identifier ?? "x", content: req.content });
    return req.identifier ?? "x";
  }),
}));

// Monday 5 October 2026, 11:00 in Lagos.
const NOW = Date.parse("2026-10-05T10:00:00Z");
const med = { id: "m1", drug_name: "Amlodipine", schedule_times: ["08:00", "20:00"], schedule_spec: null, source: "patient", dose: "5 mg", created_at: "2026-09-01T00:00:00Z" };

beforeEach(async () => {
  for (const k of Object.keys(mockTables)) delete mockTables[k];
  mockInserted.length = 0;
  scheduled.length = 0;
  await clearLocalMirror();
});

const slots = (items: { date?: string; time: string }[]) => items.map((i) => `${i.date} ${i.time}`);

describe("which doses the catch-up sheet asks about", () => {
  it("lists closed doses from yesterday and today that have no answer", async () => {
    mockTables.medications = [med];
    mockTables.medication_logs_latest_per_slot = [];
    const res = await loadCatchUpDoses("p1", NOW);
    expect(res.ok).toBe(true);
    if (res.ok) {
      // 11:00 now: both of yesterday's, and today's 08:00 (its two hour window closed at 10:00). Today's 20:00 is ahead.
      expect(slots(res.data)).toEqual(["2026-10-04 08:00", "2026-10-04 20:00", "2026-10-05 08:00"]);
      expect(res.data.every((i) => i.state === "missed")).toBe(true);
    }
  });

  it("leaves out doses the patient answered, but asks again about the server's own missed row", async () => {
    mockTables.medications = [med];
    mockTables.medication_logs_latest_per_slot = [
      { medication_id: "m1", scheduled_for_date: "2026-10-04", scheduled_time: "08:00", status: "taken", source: "patient" },
      { medication_id: "m1", scheduled_for_date: "2026-10-04", scheduled_time: "20:00", status: "missed", source: "system" },
      { medication_id: "m1", scheduled_for_date: "2026-10-05", scheduled_time: "08:00", status: "missed", source: "patient" },
    ];
    const res = await loadCatchUpDoses("p1", NOW);
    expect(res.ok && slots(res.data)).toEqual(["2026-10-04 20:00"]);
  });

  it("counts a dose logged on this phone and not yet sent as answered", async () => {
    mockTables.medications = [med];
    mockTables.medication_logs_latest_per_slot = [];
    await enqueue({
      kind: "dose",
      subjectId: "p1",
      payload: { medication_id: "m1", scheduled_time: "08:00", scheduled_for_date: "2026-10-05", status: "taken", organisation_id: "org-1" },
      holdSeconds: 600,
    });
    const res = await loadCatchUpDoses("p1", NOW);
    expect(res.ok && slots(res.data)).toEqual(["2026-10-04 08:00", "2026-10-04 20:00"]);
  });

  it("keeps a dose open while its flexible window is open, and owes nothing from before the medicine was added", async () => {
    const windowed = { ...med, schedule_spec: { startDate: null, endDate: null, foodNote: null, kind: "daily", times: ["08:00"], windowMinutes: 240 } };
    mockTables.medications = [windowed];
    mockTables.medication_logs_latest_per_slot = [];
    const res = await loadCatchUpDoses("p1", NOW); // 11:00: the 08:00 window runs to 12:00
    expect(res.ok && slots(res.data)).toEqual(["2026-10-04 08:00"]);
    mockTables.medications = [{ ...med, created_at: "2026-10-05T09:00:00Z" }];
    const added = await loadCatchUpDoses("p1", NOW);
    expect(added.ok && added.data).toEqual([]);
  });
});

describe("selecting, answering and remembering", () => {
  const items = (n: number) =>
    Array.from({ length: n }, (_, i) => ({
      medicationId: "m1",
      drugName: "A",
      time: `${String(i).padStart(2, "0")}:00`,
      date: "2026-10-04",
      status: "pending" as const,
      dueAtMs: 1000 + (n - i),
    }));

  it("drops dismissed doses, sorts oldest first and caps the list", () => {
    const all = items(20);
    expect(selectCatchUp(all, new Set())).toHaveLength(12);
    const picked = selectCatchUp(all, new Set([catchUpKey(all[19])]));
    expect(picked.map((p) => p.time)).not.toContain("19:00");
    expect(picked[0].dueAtMs).toBeLessThan(picked[1].dueAtMs!);
  });

  it("maps each answer to what is recorded", () => {
    expect(statusForChoice("took")).toBe("delayed");
    expect(statusForChoice("skipped")).toBe("skipped");
    expect(statusForChoice("not_taken")).toBe("missed");
  });

  it("logs an answer against the dose's own date, sent at once", async () => {
    const [item] = items(1);
    await expect(answerCatchUp("p1", "org-1", item, "not_taken")).resolves.toMatchObject({ synced: true });
    expect(mockInserted[0].row).toMatchObject({ status: "missed", scheduled_for_date: "2026-10-04", scheduled_time: "00:00" });
  });

  it("remembers a dismissal and survives a corrupted store", async () => {
    await saveDismissed(["a|2026-10-04|08:00"]);
    await saveDismissed(["b|2026-10-04|20:00", "a|2026-10-04|08:00"]);
    expect([...(await loadDismissed())].sort()).toEqual(["a|2026-10-04|08:00", "b|2026-10-04|20:00"]);
    const AsyncStorage = jest.requireMock("@react-native-async-storage/async-storage");
    await AsyncStorage.setItem("catch-up:dismissed", "not json");
    expect((await loadDismissed()).size).toBe(0);
    await AsyncStorage.setItem("catch-up:dismissed", JSON.stringify({ not: "a list" }));
    expect((await loadDismissed()).size).toBe(0);
  });
});

describe("how often the sheet is offered", () => {
  const gap = 240 * 60_000;
  it("offers it the first time, and again only after the gap", () => {
    expect(mayOfferCatchUp(null, NOW)).toBe(true);
    expect(mayOfferCatchUp(NOW - gap + 1, NOW)).toBe(false);
    expect(mayOfferCatchUp(NOW - gap, NOW)).toBe(true);
  });
  it("offers it when the stored time is unusable or in the future", () => {
    expect(mayOfferCatchUp(NaN, NOW)).toBe(true);
    expect(mayOfferCatchUp(NOW + 1000, NOW)).toBe(true);
  });
  it("remembers when it was last offered", async () => {
    expect(await loadLastOffered()).toBeNull();
    await saveLastOffered(NOW);
    expect(await loadLastOffered()).toBe(NOW);
  });
});

describe("flexible windows on the phone", () => {
  const windowed = { id: "w1", drug_name: "W", schedule_times: ["08:00"], schedule_spec: { startDate: null, endDate: null, foodNote: null, kind: "daily", times: ["08:00"], windowMinutes: 120 } };

  it("carries the window and keeps the dose due until it closes", () => {
    const at = (iso: string) => buildTodaysDoseChecklist([windowed], [], Date.parse(iso))[0];
    expect(at("2026-10-05T07:30:00Z")).toMatchObject({ state: "due", windowMinutes: 120, closeMinutes: 120 });
    expect(at("2026-10-05T08:30:00Z").state).toBe("due"); // 09:30, inside the 08:00 to 10:00 window
    expect(at("2026-10-05T09:30:00Z").state).toBe("missed"); // 10:30
    const long = { ...windowed, schedule_spec: { ...windowed.schedule_spec, windowMinutes: 240 } };
    expect(buildTodaysDoseChecklist([long], [], Date.parse("2026-10-05T09:30:00Z"))[0]).toMatchObject({ state: "due", closeMinutes: 240 });
  });

  it("calls a dose taken inside its window on time, and one after it taken late", () => {
    const due = Date.parse("2026-10-05T07:00:00Z");
    expect(statusForTakenAt(due, due + 3 * 3_600_000, 240)).toBe("taken");
    expect(statusForTakenAt(due, due + 3 * 3_600_000)).toBe("delayed");
  });

  it("plans a start reminder and one follow-up in the middle, with the follow-up's own wording", async () => {
    mockTables.medications = [{ ...windowed, is_active: true }];
    mockTables.medication_logs_latest_per_slot = [];
    await replanDoseReminders("p1", Date.parse("2026-10-05T05:00:00Z"));
    const followUps = scheduled.filter((s) => s.content.title === t("medicines.notify.follow_up_title", "en"));
    const dues = scheduled.filter((s) => s.content.title === t("medicines.notify.title", "en"));
    expect(dues.length).toBeGreaterThan(10);
    // S08g: follow-ups are held to their own budget (maxFollowUps = 8), never half of the places
    expect(followUps.length).toBe(8);
    expect(dues.length + followUps.length).toBeLessThanOrEqual(44);
    expect(followUps[0].content.body).toBe(t("medicines.notify.follow_up_body", "en"));
    expect(`${followUps[0].content.title} ${followUps[0].content.body}`).not.toMatch(/medicine|medication|drug|pill|tablet|mg\b/i);
  });
});
