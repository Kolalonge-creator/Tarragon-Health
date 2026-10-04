/**
 * S08: medicines on the phone. Structured schedules in today's list, the dose
 * undo window, an "I took it earlier" time reaching the server, the weekly
 * adherence read, the pill count, and the local reminder plan (including that its
 * wording names no medicine, INV-07).
 */
import { t } from "@tarragon/i18n";
import {
  activeFromMs,
  buildTodaysDoseChecklist,
  loadSupplies,
  loadWeeklyAdherence,
  logDose,
  scheduleOf,
  statusForTakenAt,
  undoDose,
} from "./medications";
import { checkReminderHealth, replanDoseReminders, snoozeDose } from "./dose-reminders";
import { flushOutbox, getPendingCount } from "./outbox";
import { clearLocalMirror } from "./offline-store";

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
      let head = false;
      const q: Record<string, unknown> = {
        select: (_cols?: string, opts?: { head?: boolean }) => {
          head = Boolean(opts?.head);
          return q;
        },
        eq: () => q,
        is: () => q,
        gte: () => q,
        in: () => q,
        or: () => q,
        order: () => q,
        limit: () => q,
        single: async () => ({ data: { organisation_id: "org-1" }, error: null }),
        insert: async (row: Row) => {
          mockInserted.push({ table, row });
          return { error: null };
        },
        then: (res: (v: unknown) => unknown) =>
          Promise.resolve({
            data: head ? null : (mockTables[table] ?? []),
            count: (mockTables[table] ?? []).length,
            error: null,
          }).then(res),
      };
      return q;
    },
  },
}));

const scheduled: { identifier: string; content: { title: string; body: string }; trigger: unknown }[] = [];
let mockPermission = "granted";
jest.mock("expo-notifications", () => ({
  SchedulableTriggerInputTypes: { DATE: "date", TIME_INTERVAL: "timeInterval" },
  AndroidImportance: { HIGH: 4 },
  setNotificationHandler: jest.fn(),
  setNotificationChannelAsync: jest.fn(async () => {}),
  getPermissionsAsync: jest.fn(async () => ({ status: mockPermission })),
  requestPermissionsAsync: jest.fn(async () => ({ status: mockPermission })),
  getAllScheduledNotificationsAsync: jest.fn(async () => scheduled.map((s) => ({ identifier: s.identifier }))),
  cancelScheduledNotificationAsync: jest.fn(async (id: string) => {
    const i = scheduled.findIndex((s) => s.identifier === id);
    if (i >= 0) scheduled.splice(i, 1);
  }),
  scheduleNotificationAsync: jest.fn(async (req: { identifier?: string; content: { title: string; body: string }; trigger: unknown }) => {
    const identifier = req.identifier ?? `anon-${scheduled.length}`;
    const existing = scheduled.findIndex((x) => x.identifier === identifier);
    if (existing >= 0) scheduled.splice(existing, 1);
    scheduled.push({ identifier, content: req.content, trigger: req.trigger });
    return req.identifier ?? "id";
  }),
}));

// Monday 5 October 2026, 11:00 in Lagos.
const NOW = Date.parse("2026-10-05T10:00:00Z");
const DAY = 86_400_000;
const base = { startDate: null, endDate: null, foodNote: null };

const daily = { id: "m-daily", drug_name: "Amlodipine", schedule_times: ["08:00", "20:00"], schedule_spec: null, source: "clinician", dose: "5 mg" };

beforeEach(async () => {
  for (const k of Object.keys(mockTables)) delete mockTables[k];
  mockInserted.length = 0;
  scheduled.length = 0;
  mockPermission = "granted";
  await clearLocalMirror();
});

describe("today's list with structured schedules", () => {
  it("expands every-other-day, weekdays and step-down, and leaves as-needed out", () => {
    const meds = [
      { id: "a", drug_name: "A", schedule_times: ["09:00"], schedule_spec: { ...base, kind: "every_n_days", times: ["09:00"], intervalDays: 2, anchorDate: "2026-10-01" } },
      { id: "b", drug_name: "B", schedule_times: ["07:30"], schedule_spec: { ...base, kind: "weekdays", times: ["07:30"], days: [1, 4] } },
      { id: "c", drug_name: "C", schedule_times: ["08:00"], schedule_spec: { ...base, startDate: "2026-10-04", kind: "taper", steps: [{ days: 2, times: ["08:00"], doseText: "half a tablet" }] } },
      { id: "d", drug_name: "D", schedule_times: [], schedule_spec: { ...base, kind: "as_needed", maxPerDay: 2 } },
    ];
    const items = buildTodaysDoseChecklist(meds, [], NOW);
    expect(items.map((i) => `${i.medicationId}@${i.time}`)).toEqual(["b@07:30", "c@08:00", "a@09:00"]);
    expect(items.find((i) => i.medicationId === "c")?.doseText).toBe("half a tablet");
  });

  it("labels the source and carries the read-only dose of a prescribed medicine", () => {
    const [first] = buildTodaysDoseChecklist([daily], [], NOW);
    expect(first).toMatchObject({ origin: "prescription", doseLabel: "5 mg", state: "missed", dueAtMs: Date.parse("2026-10-05T07:00:00Z") });
    const [own] = buildTodaysDoseChecklist([{ ...daily, source: "patient" }], [], NOW);
    expect(own.origin).toBe("patient_added");
  });

  it("derives upcoming, due and missed from the clock alone", () => {
    const at = (iso: string) => buildTodaysDoseChecklist([daily], [], Date.parse(iso)).map((i) => i.state);
    expect(at("2026-10-05T05:00:00Z")).toEqual(["upcoming", "upcoming"]); // 06:00 Lagos
    expect(at("2026-10-05T07:30:00Z")).toEqual(["due", "upcoming"]); // 08:30
    expect(at("2026-10-05T10:00:00Z")).toEqual(["missed", "upcoming"]); // 11:00, past the 2-hour window
  });

  it("maps a logged status to the state and the older three-way status", () => {
    const items = buildTodaysDoseChecklist([daily], [{ medication_id: "m-daily", scheduled_time: "08:00", status: "delayed" }], NOW);
    expect(items[0]).toMatchObject({ state: "late", status: "taken" });
  });

  it("owes nothing for a slot before the medicine was added", () => {
    const items = buildTodaysDoseChecklist([{ ...daily, created_at: "2026-10-05T09:00:00Z" }], [], NOW);
    expect(items.map((i) => i.time)).toEqual(["20:00"]);
  });

  it("owes nothing from before the schedule was edited", () => {
    const edited = { ...daily, created_at: "2026-09-01T00:00:00Z", schedule_effective_from: "2026-10-05T09:30:00Z" };
    expect(buildTodaysDoseChecklist([edited], [], NOW).map((i) => i.time)).toEqual(["20:00"]);
    expect(activeFromMs({ created_at: "2026-09-01T00:00:00Z", schedule_effective_from: null })).toBe(Date.parse("2026-09-01T00:00:00Z"));
    expect(activeFromMs({})).toBe(0);
  });

  it("carries the slot's own date so a screen left open past midnight logs the right day", () => {
    const [first] = buildTodaysDoseChecklist([daily], [], NOW);
    expect(first.date).toBe("2026-10-05");
  });

  it("falls back to the plain list of times when the structured schedule does not parse", () => {
    expect(scheduleOf({ schedule_times: ["08:00"], schedule_spec: { kind: "nonsense" } })).toMatchObject({ kind: "daily", times: ["08:00"] });
    expect(scheduleOf({ schedule_times: [], schedule_spec: null })).toMatchObject({ kind: "as_needed" });
  });

  it("records a dose taken after the missed window as taken late", () => {
    const due = Date.parse("2026-10-05T07:00:00Z");
    expect(statusForTakenAt(due, due + 60_000)).toBe("taken");
    expect(statusForTakenAt(due, due + 3 * 3_600_000)).toBe("delayed");
  });
});

describe("logging with the undo window", () => {
  const item = { medicationId: "m1", drugName: "Amlodipine", time: "08:00", status: "pending" as const };

  it("holds the row on the phone, sends nothing, and undo takes it back", async () => {
    const res = await logDose("p1", "org-1", item, "taken", { hold: true });
    expect(res).toMatchObject({ synced: false });
    expect(res.heldUntilMs).toBeGreaterThan(Date.now());
    await flushOutbox();
    expect(mockInserted).toHaveLength(0);
    expect(await getPendingCount()).toBe(1);
    expect(await undoDose(res.clientId!)).toBe(true);
    expect(await getPendingCount()).toBe(0);
    await flushOutbox();
    expect(mockInserted).toHaveLength(0);
  });

  it("undo is refused once the row is gone, and a second undo is refused", async () => {
    const res = await logDose("p1", "org-1", item, "taken");
    expect(res.synced).toBe(true);
    expect(await undoDose(res.clientId!)).toBe(false);
    const held = await logDose("p1", "org-1", item, "taken", { hold: true });
    expect(await undoDose(held.clientId!)).toBe(true);
    expect(await undoDose(held.clientId!)).toBe(false);
  });

  it("sends the chosen time and the skip reason once the window has passed", async () => {
    jest.useFakeTimers({
      now: NOW,
      doNotFake: ["nextTick", "setImmediate", "clearImmediate", "setInterval", "clearInterval", "setTimeout", "clearTimeout", "queueMicrotask", "performance", "hrtime"],
    });
    try {
      const tookAt = new Date(NOW - 45 * 60_000).toISOString();
      await logDose("p1", "org-1", item, "not_available", { hold: true, recordedAt: tookAt, reason: "ran_out" });
      await flushOutbox();
      expect(mockInserted).toHaveLength(0); // still inside the undo window
      jest.setSystemTime(NOW + 5 * 60_000);
      await flushOutbox();
      expect(mockInserted).toHaveLength(1);
      expect(mockInserted[0].row).toMatchObject({ status: "not_available", reason: "ran_out", client_recorded_at: tookAt });
    } finally {
      jest.useRealTimers();
    }
  });

  it("logs against the slot's date, not today's", async () => {
    await logDose("p1", "org-1", { ...item, date: "2026-10-04" }, "taken");
    expect(mockInserted[0].row).toMatchObject({ scheduled_for_date: "2026-10-04" });
  });

  it("without a hold it still sends at once and records the time now (older behaviour unchanged)", async () => {
    await expect(logDose("p1", "org-1", item, "taken")).resolves.toMatchObject({ synced: true });
    expect(mockInserted[0].row).toMatchObject({ status: "taken", reason: null });
  });
});

describe("weekly adherence on the phone", () => {
  it("counts doses marked taken over doses due, not the clock's guess for answered ones", async () => {
    mockTables.medications = [{ id: "m1", created_at: "2026-10-01T00:00:00Z", schedule_times: ["08:00"], schedule_spec: null }];
    mockTables.medication_logs_latest_per_slot = ["01", "02", "03", "04"].map((d) => ({
      medication_id: "m1",
      scheduled_for_date: `2026-10-${d}`,
      scheduled_time: "08:00",
      status: "taken",
      logged_at: `2026-10-${d}T07:05:00Z`,
    }));
    const res = await loadWeeklyAdherence("p1", NOW);
    expect(res.ok).toBe(true);
    if (res.ok) {
      // 1 to 5 October at 08:00: four taken, the 5th unanswered and past the window
      expect(res.data).toMatchObject({ due: 5, taken: 4, missed: 1, percent: 80, belowThreshold: false });
    }
  });

  it("says nothing for a patient with no medicines", async () => {
    mockTables.medications = [];
    const res = await loadWeeklyAdherence("p1", NOW);
    expect(res).toMatchObject({ ok: true, data: { percent: null } });
  });
});

describe("pill count", () => {
  it("estimates how long a count lasts and marks it low inside the lead days", async () => {
    mockTables.medication_supply = [{ medication_id: "m-daily", pills_on_hand: "6.0", pills_per_dose: "1.0", counted_at: "2026-10-05T05:00:00Z" }];
    mockTables.medication_logs_latest_per_slot = [];
    const res = await loadSupplies("p1", [daily], NOW);
    expect(res.ok).toBe(true);
    if (res.ok) {
      const v = res.data.get("m-daily")!;
      // 11:00 Lagos Monday: today's 20:00, then two a day: six pills cover 20:00, then 3 days
      expect(v.estimate.daysLeft).toBeLessThanOrEqual(3);
      expect(v.low).toBe(true);
    }
  });
});

describe("local dose reminders", () => {
  beforeEach(() => {
    mockTables.medications = [{ id: "m-daily", is_active: true, schedule_times: ["08:00", "20:00"], schedule_spec: null }];
    mockTables.medication_logs_latest_per_slot = [];
  });

  it("schedules a rolling plan with generic wording that names no medicine", async () => {
    const res = await replanDoseReminders("p1", NOW);
    expect(res.ok).toBe(true);
    expect(scheduled.length).toBeGreaterThan(10);
    expect(scheduled.every((s) => s.identifier.startsWith("dose|"))).toBe(true);
    const wording = scheduled.map((s) => `${s.content.title} ${s.content.body}`).join(" ");
    expect(wording).not.toMatch(/amlodipine|tablet|pill|mg\b|medicine|medication|drug/i);
    expect(scheduled[0].content.title).toBe(t("medicines.notify.title", "en"));
    expect(scheduled[0].content.body).toBe(t("medicines.notify.body", "en"));
  });

  it("stays under the iOS cap and does not duplicate on a second plan", async () => {
    await replanDoseReminders("p1", NOW);
    const first = scheduled.map((s) => s.identifier);
    expect(first.length).toBeLessThan(64);
    await replanDoseReminders("p1", NOW);
    expect(scheduled.map((s) => s.identifier)).toEqual(first);
  });

  it("cancels a dose reminder for a slot that has been answered, and leaves other notifications alone", async () => {
    scheduled.push({ identifier: "something-else", content: { title: "x", body: "y" }, trigger: null });
    await replanDoseReminders("p1", NOW);
    const before = scheduled.length;
    mockTables.medication_logs_latest_per_slot = [{ medication_id: "m-daily", scheduled_for_date: "2026-10-05", scheduled_time: "20:00", status: "taken" }];
    await replanDoseReminders("p1", NOW);
    expect(scheduled.length).toBe(before - 1);
    expect(scheduled.some((s) => s.identifier === "something-else")).toBe(true);
    expect(scheduled.some((s) => s.identifier === `dose|${Date.parse("2026-10-05T19:00:00Z")}`)).toBe(false);
  });

  it("plans nothing, and says so, when notifications are not allowed", async () => {
    mockPermission = "denied";
    const res = await replanDoseReminders("p1", NOW);
    expect(res).toEqual({ ok: false, planned: 0, pending: 0, allowed: false });
    expect(scheduled).toHaveLength(0);
    expect(await checkReminderHealth("p1", NOW)).toContain("notifications_off");
  });

  it("never raises the OS permission prompt on its own, only when the screen asks", async () => {
    const Notifications = jest.requireMock("expo-notifications");
    mockPermission = "undetermined";
    await replanDoseReminders("p1", NOW);
    expect(Notifications.requestPermissionsAsync).not.toHaveBeenCalled();
    await replanDoseReminders("p1", NOW, { prompt: true });
    expect(Notifications.requestPermissionsAsync).toHaveBeenCalledTimes(1);
  });

  it("reports a plan that never reached the phone", async () => {
    expect(await checkReminderHealth("p1", NOW)).toEqual(expect.arrayContaining(["nothing_scheduled", "plan_out_of_date"]));
    await replanDoseReminders("p1", NOW);
    expect(await checkReminderHealth("p1", NOW + 60_000)).toEqual([]);
    expect(await checkReminderHealth("p1", NOW + 3 * DAY)).toContain("plan_out_of_date");
  });

  it("limits a snooze to the configured number of times", async () => {
    const slot = "m-daily|2026-10-05|08:00";
    const results = [];
    for (let i = 0; i < 4; i += 1) results.push(await snoozeDose(slot));
    expect(results.slice(0, 3).every((r) => r.ok)).toBe(true);
    expect(results[3]).toEqual({ ok: false, reason: "limit" });
    expect(scheduled.filter((s) => s.identifier.startsWith("snooze|"))).toHaveLength(1);
  });
});
