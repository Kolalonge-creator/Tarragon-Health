import AsyncStorage from "@react-native-async-storage/async-storage";
import { finishContractionSession, finishKickSession, evaluateKickNow, kickCounterOffered } from "./pregnancy-sessions";

const mockEnqueue = jest.fn(async (_input: unknown) => ({}));
jest.mock("./outbox", () => ({ enqueue: (input: unknown) => mockEnqueue(input) }));
jest.mock("./supabase", () => ({ supabase: {} }));

const SUBJECT = "user-s67";
const NOW = Date.parse("2026-10-05T10:00:00.000Z");
const MIN = 60_000;
const OBSTETRIC_KEY = `@tarragon/obstetric/v1:${SUBJECT}`;
const HISTORY = `@tarragon/kick-history/v1:${SUBJECT}`;
const taps = (start: number, n: number, every: number) => Array.from({ length: n }, (_, i) => start + (i + 1) * every * MIN);

beforeEach(async () => {
  mockEnqueue.mockClear();
  await AsyncStorage.removeItem(HISTORY);
  // 31 weeks on 2026-10-05 (last period 2026-03-01)
  await AsyncStorage.setItem(OBSTETRIC_KEY, JSON.stringify({ pregnant: true, lastDeliveryDate: null, fetchedAtMs: 1, lmp: "2026-03-01", edd: null }));
});

describe("kick counter on the phone", () => {
  it("is offered from week 28 when she is pregnant, not otherwise", async () => {
    expect(await kickCounterOffered(SUBJECT, NOW)).toBe(true);
    await AsyncStorage.setItem(OBSTETRIC_KEY, JSON.stringify({ pregnant: true, lastDeliveryDate: null, fetchedAtMs: 1, lmp: "2026-08-01", edd: null }));
    expect(await kickCounterOffered(SUBJECT, NOW)).toBe(false);
    await AsyncStorage.removeItem(OBSTETRIC_KEY);
    expect(await kickCounterOffered(SUBJECT, NOW)).toBe(false);
  });

  it("10 movements in an hour is queued as a normal (not danger) session with the config version", async () => {
    const start = NOW - 60 * MIN;
    const e = await finishKickSession({ subjectId: SUBJECT, organisationId: "o1", startedAtMs: start, movementMs: taps(start, 10, 6), nowMs: NOW });
    expect(e.state).toBe("target_reached");
    expect(mockEnqueue).toHaveBeenCalledTimes(1);
    const arg = mockEnqueue.mock.calls[0]![0] as { kind: string; danger: boolean; payload: { result: string; week_at_start: number; config_version: number } };
    expect(arg).toMatchObject({ kind: "kick_session", danger: false, payload: { result: "target_reached", week_at_start: 31, config_version: 1 } });
  });

  it("fewer than 10 at 2 hours is the contact-today result, queued as DANGER, with its reason", async () => {
    const start = NOW - 125 * MIN;
    const e = await finishKickSession({ subjectId: SUBJECT, organisationId: "o1", startedAtMs: start, movementMs: taps(start, 6, 10), nowMs: NOW });
    expect(e).toMatchObject({ state: "contact_today", reason: "window_elapsed_without_target" });
    expect(mockEnqueue.mock.calls[0]![0]).toMatchObject({ kind: "kick_session", danger: true, payload: { result: "contact_today", result_reason: "window_elapsed_without_target" } });
  });

  it("the card works with nothing but the phone: no server call is made to decide it", async () => {
    const start = NOW - 125 * MIN;
    const e = await evaluateKickNow({ subjectId: SUBJECT, startedAtMs: start, movementMs: taps(start, 3, 10), nowMs: NOW });
    expect(e.state).toBe("contact_today");
  });

  it("builds her personal normal from finished sessions and then flags a clear drop", async () => {
    for (const minutes of [20, 25, 30]) {
      const start = NOW - 200 * MIN;
      await finishKickSession({ subjectId: SUBJECT, organisationId: "o1", startedAtMs: start, movementMs: taps(start, 10, minutes / 10), nowMs: start + 60 * MIN });
    }
    const start = NOW - 100 * MIN;
    const e = await finishKickSession({ subjectId: SUBJECT, organisationId: "o1", startedAtMs: start, movementMs: taps(start, 10, 9), nowMs: NOW });
    expect(e).toMatchObject({ state: "contact_today", reason: "clear_drop" });
  });

  it("a session stopped early is stored as stopped and does not change her normal", async () => {
    const start = NOW - 10 * MIN;
    const e = await finishKickSession({ subjectId: SUBJECT, organisationId: "o1", startedAtMs: start, movementMs: taps(start, 2, 2), nowMs: NOW });
    expect(e.state).toBe("counting");
    expect(mockEnqueue.mock.calls[0]![0]).toMatchObject({ danger: false, payload: { result: "stopped", result_reason: null } });
    expect(await AsyncStorage.getItem(HISTORY)).toBeNull();
  });
});

describe("contraction timer on the phone", () => {
  const run = (n: number, gap: number, start: number) => Array.from({ length: n }, (_, i) => ({ startMs: start + i * gap * MIN, endMs: start + i * gap * MIN + 60_000 }));

  it("a waters-break sign is go now with no contractions, queued as DANGER", async () => {
    const e = await finishContractionSession({ subjectId: SUBJECT, organisationId: "o1", startedAtMs: NOW, contractions: [], signs: ["waters_break"], flags: null, nowMs: NOW });
    expect(e).toMatchObject({ state: "go_now", reason: "instant_sign" });
    expect(mockEnqueue.mock.calls[0]![0]).toMatchObject({ kind: "contraction_session", danger: true, payload: { result: "go_now", result_reason: "instant_sign", instant_signs: ["waters_break"] } });
  });

  it("an hour of contractions every 5 minutes at 39 weeks is go now (pattern); the earlier pattern needs the birth plan", async () => {
    await AsyncStorage.setItem(OBSTETRIC_KEY, JSON.stringify({ pregnant: true, lastDeliveryDate: null, fetchedAtMs: 1, lmp: "2026-01-05", edd: null }));
    const start = NOW - 62 * MIN;
    const c = run(13, 5, start);
    const e = await finishContractionSession({ subjectId: SUBJECT, organisationId: "o1", startedAtMs: start, contractions: c, signs: [], flags: null, nowMs: NOW });
    expect(e).toMatchObject({ state: "go_now", reason: "pattern", pattern: "standard" });
    const six = run(12, 6, start);
    const keep = await finishContractionSession({ subjectId: SUBJECT, organisationId: "o1", startedAtMs: start, contractions: six, signs: [], flags: null, nowMs: NOW });
    expect(keep.state).toBe("keep_timing");
    const earlier = await finishContractionSession({ subjectId: SUBJECT, organisationId: "o1", startedAtMs: start, contractions: six, signs: [], flags: { longJourney: true, previousFastLabour: false, previousBirths: 0 }, nowMs: NOW });
    expect(earlier).toMatchObject({ state: "go_now", pattern: "earlier" });
  });

  it("any contraction before 37 weeks is go now", async () => {
    await AsyncStorage.setItem(OBSTETRIC_KEY, JSON.stringify({ pregnant: true, lastDeliveryDate: null, fetchedAtMs: 1, lmp: "2026-03-01", edd: null }));
    const e = await finishContractionSession({ subjectId: SUBJECT, organisationId: "o1", startedAtMs: NOW, contractions: run(1, 5, NOW), signs: [], flags: null, nowMs: NOW });
    expect(e).toMatchObject({ state: "go_now", reason: "before_term" });
  });
});
