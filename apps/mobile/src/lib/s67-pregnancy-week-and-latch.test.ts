/**
 * S67 follow-up: the phone's cards use the week the screen shows, a shown go-now answer is saved as shown, and the small pregnancy facts
 * live in the encrypted store, not plain AsyncStorage.
 */
import AsyncStorage from "@react-native-async-storage/async-storage";
import { evaluateContractionsNow, finishContractionSession, finishKickSession, kickCounterOffered } from "./pregnancy-sessions";
import type { ObstetricCache } from "./obstetric-status";
import { localGet } from "./pregnancy-local";

const mockEnqueue = jest.fn(async (input: unknown) => {
  void input;
  return {};
});
jest.mock("./outbox", () => ({ enqueue: (input: unknown) => mockEnqueue(input) }));
jest.mock("./supabase", () => ({ supabase: {} }));
let mockObstetric: ObstetricCache | null = null;
jest.mock("./obstetric-status", () => {
  const actual = jest.requireActual("./obstetric-status");
  return { ...actual, readPregnancyWeek: async (_s: string, nowMs: number) => actual.pregnancyWeekFrom(mockObstetric, nowMs) };
});

const SUBJECT = "user-week";
const NOW = Date.parse("2026-10-05T10:00:00.000Z");
const MIN = 60_000;
const run = (n: number, gap: number, start: number) => Array.from({ length: n }, (_, i) => ({ startMs: start + i * gap * MIN, endMs: start + i * gap * MIN + 60_000 }));

beforeEach(() => {
  mockEnqueue.mockClear();
  // The cache says 31 weeks; the screen can say something else.
  mockObstetric = { pregnant: true, lastDeliveryDate: null, fetchedAtMs: 1, lmp: "2026-03-01", edd: null };
});

describe("the screen's week wins over the cached week", () => {
  it("the counter is offered by the passed week, not the cached one", async () => {
    expect(await kickCounterOffered(SUBJECT, NOW)).toBe(true); // cache: 31 weeks
    expect(await kickCounterOffered(SUBJECT, NOW, 20)).toBe(false); // screen: 20 weeks
    mockObstetric = null;
    expect(await kickCounterOffered(SUBJECT, NOW)).toBe(false); // no cache and nothing passed: as before
    expect(await kickCounterOffered(SUBJECT, NOW, 31)).toBe(true);
  });

  it("an unknown week passed by the screen still offers the counter (never 'not yet')", async () => {
    expect(await kickCounterOffered(SUBJECT, NOW, null)).toBe(true);
  });

  it("the before-37-weeks check and the saved week use the passed week", async () => {
    const e = await evaluateContractionsNow({ subjectId: SUBJECT, contractions: run(1, 5, NOW), signs: [], flags: null, nowMs: NOW, week: 34 });
    expect(e).toMatchObject({ state: "go_now", reason: "before_term" });
    const term = await evaluateContractionsNow({ subjectId: SUBJECT, contractions: run(1, 5, NOW), signs: [], flags: null, nowMs: NOW, week: 39 });
    expect(term.state).toBe("keep_timing");
    await finishKickSession({ subjectId: SUBJECT, organisationId: "o1", startedAtMs: NOW - 60 * MIN, movementMs: [], reportedLess: true, nowMs: NOW, week: 33 });
    expect(mockEnqueue.mock.calls[0]![0]).toMatchObject({ payload: { week_at_start: 33 } });
  });
});

describe("a go-now answer already shown is saved as shown", () => {
  it("is not turned back into keep_timing by a contraction that started after it", async () => {
    const start = NOW - 62 * MIN;
    const met = run(13, 5, start);
    const shown = await evaluateContractionsNow({ subjectId: SUBJECT, contractions: met, signs: [], flags: null, nowMs: NOW, week: 39 });
    expect(shown).toMatchObject({ state: "go_now", reason: "pattern" });
    // the next contraction has just begun (open, zero seconds long): the live rule no longer counts the run
    const after = [...met, { startMs: NOW, endMs: null }];
    const live = await evaluateContractionsNow({ subjectId: SUBJECT, contractions: after, signs: [], flags: null, nowMs: NOW, week: 39 });
    expect(live.state).toBe("keep_timing");
    await finishContractionSession({ subjectId: SUBJECT, organisationId: "o1", startedAtMs: start, contractions: after, signs: [], flags: null, nowMs: NOW, week: 39, known: shown });
    expect(mockEnqueue.mock.calls[0]![0]).toMatchObject({ danger: true, payload: { result: "go_now", result_reason: "pattern" } });
  });
});

describe("kick history is in the encrypted store", () => {
  it("is not written to plain AsyncStorage, and an old plain copy is moved across once", async () => {
    const start = NOW - 60 * MIN;
    await finishKickSession({ subjectId: SUBJECT, organisationId: "o1", startedAtMs: start, movementMs: Array.from({ length: 10 }, (_, i) => start + (i + 1) * 5 * MIN), nowMs: NOW, week: 31 });
    expect(await AsyncStorage.getItem(`@tarragon/kick-history/v1:${SUBJECT}`)).toBeNull();
    expect(await localGet(`kick-history:${SUBJECT}`)).not.toBeNull();

    await AsyncStorage.setItem("@tarragon/kick-history/v1:legacy-user", JSON.stringify([{ m: 12 }]));
    expect(await localGet("kick-history:legacy-user", "@tarragon/kick-history/v1:legacy-user")).toBe(JSON.stringify([{ m: 12 }]));
    expect(await AsyncStorage.getItem("@tarragon/kick-history/v1:legacy-user")).toBeNull();
  });
});
