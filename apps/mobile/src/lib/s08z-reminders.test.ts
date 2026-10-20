/**
 * S08z: the local reminder plan for anchored doses. The text names the part of the day in plain words and nothing else (INV-07),
 * only when every dose in the notification is tied to the same part of the day, and a day shift moves the times.
 */
import { t } from "@tarragon/i18n";
import { replanDoseReminders } from "./dose-reminders";
import { __resetAnchorProfilesForTests } from "./anchor-profile";
import { clearLocalMirror, pullChanges } from "./offline-store";

type Row = Record<string, unknown>;
const mockTables: Record<string, Row[]> = {};

jest.mock("./supabase", () => ({
  supabase: {
    auth: { getSession: async () => ({ data: { session: { user: { id: "user-1" } } } }) },
    from: (table: string) => {
      let head = false;
      const q: Record<string, unknown> = {
        select: (_c?: string, opts?: { head?: boolean }) => {
          head = Boolean(opts?.head);
          return q;
        },
        eq: () => q,
        is: () => q,
        gte: () => q,
        lte: () => q,
        in: () => q,
        or: () => q,
        order: () => q,
        limit: () => q,
        single: async () => ({ data: { organisation_id: "org-1" }, error: null }),
        then: (res: (v: unknown) => unknown) => Promise.resolve({ data: head ? null : (mockTables[table] ?? []), count: (mockTables[table] ?? []).length, error: null }).then(res),
      };
      return q;
    },
  },
}));

const scheduled: { identifier: string; content: { title: string; body: string }; trigger: { date: Date } }[] = [];
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
  scheduleNotificationAsync: jest.fn(async (req: { identifier?: string; content: { title: string; body: string }; trigger: { date: Date } }) => {
    const identifier = req.identifier ?? `anon-${scheduled.length}`;
    const existing = scheduled.findIndex((x) => x.identifier === identifier);
    if (existing >= 0) scheduled.splice(existing, 1);
    scheduled.push({ identifier, content: req.content, trigger: req.trigger });
    return identifier;
  }),
}));

// Monday 5 October 2026, 06:00 Lagos.
const NOW = Date.parse("2026-10-05T05:00:00Z");
const base = { startDate: null, endDate: null, foodNote: null };
const breakfast = { id: "m-b", is_active: true, schedule_times: ["07:30"], schedule_spec: { ...base, kind: "daily", times: [], anchored: [{ anchor: "breakfast", offsetMinutes: 0 }] } };
const breakfastPlus = { id: "m-b2", is_active: true, schedule_times: ["08:00"], schedule_spec: { ...base, kind: "daily", times: [], anchored: [{ anchor: "breakfast", offsetMinutes: 30 }] } };
const fixed = { id: "m-f", is_active: true, schedule_times: ["07:30"], schedule_spec: null };

beforeEach(async () => {
  for (const k of Object.keys(mockTables)) delete mockTables[k];
  mockTables.medication_logs_latest_per_slot = [];
  scheduled.length = 0;
  __resetAnchorProfilesForTests();
  await clearLocalMirror();
});

/** What the server holds for this person, mirrored onto the phone the way a real pull does. */
async function seed(times: { anchor: string; effective_from: string; local_time: string }[], shifts: Row[] = []): Promise<void> {
  mockTables.patient_dose_anchors = times;
  mockTables.patient_day_shifts = shifts;
  await pullChanges("p1");
}

const hhmm = (d: Date) => new Date(d.getTime() + 3_600_000).toISOString().slice(11, 16);

describe("reminders for anchored doses", () => {
  it("fires at the resolved time and says the part of the day in plain words, with no medicine named", async () => {
    await seed([{ anchor: "breakfast", effective_from: "2026-01-01", local_time: "08:15" }]);
    mockTables.medications = [breakfast];
    expect((await replanDoseReminders("p1", NOW)).ok).toBe(true);
    const first = scheduled[0]!;
    expect(hhmm(first.trigger.date)).toBe("08:15");
    expect(first.content.body).toBe(t("doseanchor.notify.body", "en", { when: "with breakfast" }));
    const wording = scheduled.map((s) => `${s.content.title} ${s.content.body}`).join(" ");
    expect(wording).not.toMatch(/amlodipine|tablet|pill|\bmg\b|medic|drug|dose/i);
    expect(wording).not.toMatch(/—|–/);
  });

  it("says an offset in plain words", async () => {
    mockTables.medications = [breakfastPlus];
    await replanDoseReminders("p1", NOW);
    expect(scheduled[0]?.content.body).toBe(t("doseanchor.notify.body", "en", { when: "30 minutes after breakfast" }));
  });

  it("uses the generic wording when a clock-time dose shares the minute, so nothing is implied that is not true of all", async () => {
    mockTables.medications = [breakfast, fixed];
    await replanDoseReminders("p1", NOW);
    expect(scheduled[0]?.content.body).toBe(t("medicines.notify.body", "en"));
  });

  it("a day shift moves the reminder for those dates only, and the next day is back to normal", async () => {
    await seed(
      [{ anchor: "breakfast", effective_from: "2026-01-01", local_time: "08:00" }],
      [{ id: "s", starts_on: "2026-10-05", ends_on: "2026-10-05", offsets: { breakfast: 120 }, cancelled_from: null, created_at: "2026-10-01T00:00:00Z" }]
    );
    mockTables.medications = [breakfast];
    await replanDoseReminders("p1", NOW);
    const times = scheduled.slice(0, 2).map((s) => `${s.trigger.date.toISOString().slice(0, 10)} ${hhmm(s.trigger.date)}`);
    expect(times).toEqual(["2026-10-05 10:00", "2026-10-06 08:00"]);
  });

  it("changing an anchor time cancels the old reminder and plans the new one, never a duplicate", async () => {
    await seed([{ anchor: "breakfast", effective_from: "2026-01-01", local_time: "08:00" }]);
    mockTables.medications = [breakfast];
    await replanDoseReminders("p1", NOW);
    const before = scheduled.length;
    await seed([{ anchor: "breakfast", effective_from: "2026-01-01", local_time: "09:00" }]);
    await replanDoseReminders("p1", NOW);
    expect(scheduled.length).toBe(before);
    expect(hhmm(scheduled[0]!.trigger.date)).toBe("09:00");
  });
});
