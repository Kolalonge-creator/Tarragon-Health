/**
 * S11e: the reminder to measure again. After a very high reading with no emergency symptom the phone schedules one neutral
 * local notification for 2 hours later (the time comes from the rule set); a graded result cancels it; no permission means
 * no reminder and no error. The wording never names a condition or a reading (INV-07).
 */
import { en, pcm } from "@tarragon/i18n";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { postVitalReading } from "./api";
import { discardRejectedRow, flushOutbox, listOutbox } from "./outbox";
import { cancelRecheckReminder, recheckReminderId, scheduleRecheckReminder } from "./recheck-reminder";
import { answerSymptomQuestion } from "./symptom-question";
import { clearPendingRecheck, gradeOnDevice } from "./triage-device";

let mockInsertError: { code?: string; message?: string } | null = null;
let mockRpc: jest.Mock;
let mockMirror: () => Promise<unknown[]>;

jest.mock("./supabase", () => ({
  supabase: {
    auth: { getSession: async () => ({ data: { session: { user: { id: "user-1" } } } }) },
    rpc: (...args: unknown[]) => mockRpc(...args),
    from: () => ({
      select: () => ({ eq: () => ({ single: async () => ({ data: { organisation_id: "org-1" }, error: null }) }) }),
      insert: async () => ({ error: mockInsertError }),
    }),
  },
}));
jest.mock("./api", () => ({ ...(jest.requireActual("./api") as object), postVitalReading: jest.fn() }));
jest.mock("./offline-store", () => ({
  ...(jest.requireActual("./offline-store") as object),
  readLocalRecords: () => mockMirror(),
}));

type Scheduled = { identifier: string; content: { title: string; body: string }; trigger: { date: Date; channelId?: string } };
const scheduled: Scheduled[] = [];
let mockPermission = "granted";
const mockRequest = jest.fn(async () => ({ status: mockPermission === "undetermined" ? "granted" : mockPermission }));
jest.mock("expo-notifications", () => ({
  SchedulableTriggerInputTypes: { DATE: "date" },
  AndroidImportance: { HIGH: 4 },
  AndroidNotificationVisibility: { PRIVATE: 0 },
  setNotificationHandler: jest.fn(),
  setNotificationChannelAsync: jest.fn(async () => {}),
  getPermissionsAsync: jest.fn(async () => ({ status: mockPermission })),
  requestPermissionsAsync: (...a: unknown[]) => mockRequest(...(a as [])),
  cancelScheduledNotificationAsync: jest.fn(async (id: string) => {
    const i = scheduled.findIndex((s) => s.identifier === id);
    if (i >= 0) scheduled.splice(i, 1);
  }),
  scheduleNotificationAsync: jest.fn(async (req: Scheduled) => {
    const i = scheduled.findIndex((s) => s.identifier === req.identifier);
    if (i >= 0) scheduled.splice(i, 1);
    scheduled.push(req);
    return req.identifier;
  }),
}));

const mockPost = postVitalReading as jest.MockedFunction<typeof postVitalReading>;
const SUBJECT = "user-1";
const NOW = Date.parse("2026-10-05T10:00:00.000Z");
const HOURS = 60 * 60_000;

beforeEach(async () => {
  mockInsertError = null;
  mockRpc = jest.fn(async () => ({ data: null, error: null }));
  mockMirror = async () => [];
  mockPost.mockReset();
  mockPost.mockImplementation(async () => ({ success: true }));
  mockInsertError = { code: "42501" };
  await flushOutbox();
  for (const row of await listOutbox()) await discardRejectedRow(row.clientId);
  mockInsertError = null;
  scheduled.length = 0;
  mockPermission = "granted";
  mockRequest.mockClear();
  await clearPendingRecheck(SUBJECT);
  await AsyncStorage.removeItem("@tarragon/triage/rules/v1");
  scheduled.length = 0;
});

const grade = (over: Partial<Parameters<typeof gradeOnDevice>[0]> = {}) =>
  gradeOnDevice({ subjectId: SUBJECT, systolic: 205, diastolic: 100, symptoms: [], symptomsAnswered: true, nowMs: NOW, ...over });

describe("the 2 hour reminder", () => {
  it("205/100 with no symptom schedules one reminder 2 hours after the reading", async () => {
    await grade();
    expect(scheduled).toHaveLength(1);
    expect(scheduled[0]?.identifier).toBe(recheckReminderId(SUBJECT));
    expect(scheduled[0]?.trigger.date.getTime()).toBe(NOW + 2 * HOURS);
    expect(scheduled[0]?.content.title).toBe(en["notify.triage.recheck_due.title"]);
    expect(scheduled[0]?.content.body).toBe(en["notify.triage.recheck_due.body"]);
  });

  it("answering none on the question sheet schedules it too", async () => {
    await answerSymptomQuestion({ subjectId: SUBJECT, systolic: 205, diastolic: 100, gradedAtMs: NOW, symptoms: [] });
    expect(scheduled).toHaveLength(1);
    expect(scheduled[0]?.trigger.date.getTime()).toBe(NOW + 2 * HOURS);
  });

  it("an ordinary urgent reading is reminded after the standard 5 minutes, not 2 hours", async () => {
    await grade({ systolic: 182, diastolic: 112 });
    expect(scheduled[0]?.trigger.date.getTime()).toBe(NOW + 5 * 60_000);
  });

  it("a second very high reading replaces the reminder; there is never more than one", async () => {
    await grade();
    await grade({ nowMs: NOW + 6 * 60_000 });
    expect(scheduled).toHaveLength(1);
    expect(scheduled[0]?.trigger.date.getTime()).toBe(NOW + 6 * 60_000 + 2 * HOURS);
  });

  it("a graded result cancels it: the repeat at 2 hours, a red answer, and a plain clear", async () => {
    await grade();
    await grade({ systolic: 150, diastolic: 92, nowMs: NOW + 125 * 60_000 });
    expect(scheduled).toHaveLength(0);
    await grade();
    await grade({ systolic: 205, diastolic: 100, symptoms: ["chest_pain"], nowMs: NOW + 10 * 60_000 });
    expect(scheduled).toHaveLength(0);
    await grade();
    await clearPendingRecheck(SUBJECT);
    expect(scheduled).toHaveLength(0);
  });

  it("a symptom answer of yes schedules nothing", async () => {
    await answerSymptomQuestion({ subjectId: SUBJECT, systolic: 205, diastolic: 100, gradedAtMs: NOW, symptoms: ["chest_pain"] });
    expect(scheduled).toHaveLength(0);
  });

  it("no permission: no reminder, no error, and a refusal is not asked again", async () => {
    mockPermission = "denied";
    expect(await scheduleRecheckReminder(SUBJECT, NOW + HOURS, NOW)).toBe("no_permission");
    expect(mockRequest).not.toHaveBeenCalled();
    const d = await grade();
    expect(d.result.status).toBe("recheck_required");
    expect(scheduled).toHaveLength(0);
  });

  it("undetermined permission is asked once, from the save the patient just made", async () => {
    mockPermission = "undetermined";
    expect(await scheduleRecheckReminder(SUBJECT, NOW + HOURS, NOW)).toBe("scheduled");
    expect(mockRequest).toHaveBeenCalledTimes(1);
  });

  it("a time already past is not scheduled, and cancelling when nothing is scheduled is harmless", async () => {
    expect(await scheduleRecheckReminder(SUBJECT, NOW - 1, NOW)).toBe("past");
    expect(scheduled).toHaveLength(0);
    await expect(cancelRecheckReminder(SUBJECT)).resolves.toBeUndefined();
  });

  it("a failing notification library never breaks grading", async () => {
    const N = jest.requireMock("expo-notifications");
    N.scheduleNotificationAsync.mockRejectedValueOnce(new Error("native"));
    const d = await grade();
    expect(d.result.status).toBe("recheck_required");
    expect(await scheduleRecheckReminder(SUBJECT, NOW + HOURS, NOW)).toBe("scheduled");
  });
});

describe("the wording", () => {
  const FORBIDDEN = [/\bblood\b/i, /\bpressure\b/i, /\bbp\b/i, /\breadings?\b/i, /\bhigh\b/i, /\burgent\b/i, /\bemergency\b/i, /\bsymptoms?\b/i, /\bmedic\w*/i, /\bhospital\b/i, /\d/];
  it("names no condition, reading or number, in either language", () => {
    for (const cat of [en, pcm] as Record<string, string>[]) {
      for (const key of ["notify.triage.recheck_due.title", "notify.triage.recheck_due.body", "notify.triage.recheck_due.channel"]) {
        const hits = FORBIDDEN.filter((re) => re.test(cat[key] ?? "")).map((re) => re.source);
        expect([key, hits]).toEqual([key, []]);
      }
    }
  });
});
