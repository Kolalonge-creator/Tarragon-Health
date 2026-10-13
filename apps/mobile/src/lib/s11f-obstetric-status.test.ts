/**
 * S11f: the phone knows when a person is pregnant or in the first weeks after a birth, so the engine's pregnancy and
 * postpartum lines apply on the device exactly as they do on the server (OQ-90). Offline readings use the last known answer.
 */
import AsyncStorage from "@react-native-async-storage/async-storage";
import { BP_CARE_V1 } from "@tarragon/clinical";
import { gradeOnDevice, clearPendingRecheck } from "./triage-device";
import { FALLBACK_POSTPARTUM_DAYS, readObstetricCache, readObstetricStatus, refreshObstetricStatus, statusFrom } from "./obstetric-status";

let mockPregnancy: { data: unknown; error: unknown } = { data: null, error: null };
let mockPostnatal: { data: unknown; error: unknown } = { data: [], error: null };
let mockThrow = false;
jest.mock("./supabase", () => ({
  supabase: {
    from: (table: string) => {
      if (mockThrow) throw new Error("network");
      if (table === "patient_pregnancy") return { select: () => ({ eq: () => ({ maybeSingle: async () => mockPregnancy }) }) };
      return { select: () => ({ eq: () => ({ order: () => ({ limit: async () => mockPostnatal }) }) }) };
    },
  },
}));

const SUBJECT = "user-1";
const NOW = Date.parse("2026-10-05T10:00:00.000Z"); // 11:00 in Lagos
const KEY = `@tarragon/obstetric/v1:${SUBJECT}`;
const put = (v: object) => AsyncStorage.setItem(KEY, JSON.stringify(v));
const grade = (systolic: number, diastolic: number, symptoms: never[] | string[] = []) =>
  gradeOnDevice({ subjectId: SUBJECT, systolic, diastolic, symptoms: symptoms as never[], symptomsAnswered: true, nowMs: NOW });

beforeEach(async () => {
  mockPregnancy = { data: null, error: null };
  mockPostnatal = { data: [], error: null };
  mockThrow = false;
  await AsyncStorage.removeItem(KEY);
  await AsyncStorage.removeItem("@tarragon/triage/rules/v1");
  await clearPendingRecheck(SUBJECT);
});

describe("statusFrom", () => {
  const cache = (lastDeliveryDate: string | null, pregnant = false) => ({ pregnant, lastDeliveryDate, fetchedAtMs: 0 });
  it("knows nothing without a cache: not pregnant, not postpartum", () => expect(statusFrom(null, NOW)).toEqual({ pregnant: false, postpartum: false }));
  it("pregnant comes straight from the cache", () => expect(statusFrom(cache(null, true), NOW)).toEqual({ pregnant: true, postpartum: false }));
  it("postpartum for the 42 days from the delivery date, counted in Lagos days", () => {
    expect(statusFrom(cache("2026-10-05"), NOW).postpartum).toBe(true); // the day itself
    expect(statusFrom(cache("2026-08-25"), NOW).postpartum).toBe(true); // 41 days
    expect(statusFrom(cache("2026-08-24"), NOW).postpartum).toBe(false); // 42 days
    expect(statusFrom(cache("2026-10-06"), NOW).postpartum).toBe(false); // a date in the future
  });
  it("uses the rule set's window when it gives one", () => {
    expect(statusFrom(cache("2026-09-25"), NOW, 7).postpartum).toBe(false);
    expect(statusFrom(cache("2026-09-25"), NOW, 14).postpartum).toBe(true);
    expect(FALLBACK_POSTPARTUM_DAYS).toBe(BP_CARE_V1.params.postpartum.windowDays);
  });
  it("counts a delivery just before Lagos midnight on the right day", () => {
    const lateUtc = Date.parse("2026-10-05T23:30:00Z"); // already 6 October in Lagos
    expect(statusFrom(cache("2026-08-25"), lateUtc).postpartum).toBe(false); // 42 Lagos days
  });
});

describe("the cache", () => {
  it("ignores a corrupt or incomplete copy", async () => {
    await AsyncStorage.setItem(KEY, "{not json");
    expect(await readObstetricCache(SUBJECT)).toBeNull();
    await put({ pregnant: "yes", fetchedAtMs: 1 });
    expect(await readObstetricCache(SUBJECT)).toBeNull();
    await put({ pregnant: false, lastDeliveryDate: "not a date", fetchedAtMs: 1 });
    expect(await readObstetricCache(SUBJECT)).toBeNull();
    expect(await readObstetricStatus(SUBJECT, NOW)).toEqual({ pregnant: false, postpartum: false });
  });
});

describe("refresh", () => {
  it("keeps a pregnancy and the latest delivery", async () => {
    mockPregnancy = { data: { is_pregnant: true }, error: null };
    mockPostnatal = { data: [{ delivery_date: "2026-09-20" }], error: null };
    expect(await refreshObstetricStatus(SUBJECT, NOW)).toBe("updated");
    expect(await readObstetricStatus(SUBJECT, NOW)).toEqual({ pregnant: true, postpartum: true });
  });
  it("no rows at all means not pregnant and no delivery", async () => {
    expect(await refreshObstetricStatus(SUBJECT, NOW)).toBe("updated");
    expect(await readObstetricCache(SUBJECT)).toMatchObject({ pregnant: false, lastDeliveryDate: null });
  });
  it("a failed read keeps the old answer: an error is not 'not pregnant'", async () => {
    await put({ pregnant: true, lastDeliveryDate: null, fetchedAtMs: 1 });
    mockPregnancy = { data: null, error: { message: "boom" } };
    expect(await refreshObstetricStatus(SUBJECT, NOW)).toBe("failed");
    mockPregnancy = { data: { is_pregnant: false }, error: null };
    mockPostnatal = { data: null, error: { message: "boom" } };
    expect(await refreshObstetricStatus(SUBJECT, NOW)).toBe("failed");
    mockThrow = true;
    expect(await refreshObstetricStatus(SUBJECT, NOW)).toBe("failed");
    expect(await readObstetricStatus(SUBJECT, NOW)).toEqual({ pregnant: true, postpartum: false });
  });
});

describe("grading on the phone", () => {
  it("with no answer yet an adult reading is graded on the adult lines (as before)", async () => {
    expect((await grade(162, 100)).result.ruleId).toBe("BP-G2");
  });
  it("pregnant: 160 systolic is red, with the pregnancy lines, offline from the cache", async () => {
    await put({ pregnant: true, lastDeliveryDate: null, fetchedAtMs: 1 });
    const d = await grade(162, 100);
    expect(d.result).toMatchObject({ grade: "red", ruleId: "BP-P3" });
    expect(d.severity).toBe("emergency");
  });
  it("pregnant: a raised reading with a pre-eclampsia symptom is red", async () => {
    await put({ pregnant: true, lastDeliveryDate: null, fetchedAtMs: 1 });
    expect((await grade(142, 92, ["severe_headache"])).result.ruleId).toBe("BP-P4");
  });
  it("postpartum: 150/95 goes to a clinician, 162/100 is red", async () => {
    await put({ pregnant: false, lastDeliveryDate: "2026-09-20", fetchedAtMs: 1 });
    expect((await grade(150, 95)).result).toMatchObject({ grade: "amber", ruleId: "BP-P5" });
    expect((await grade(162, 100)).result).toMatchObject({ grade: "red", ruleId: "BP-P3" });
  });
  it("after the window the postpartum lines stop", async () => {
    await put({ pregnant: false, lastDeliveryDate: "2026-08-01", fetchedAtMs: 1 });
    expect((await grade(150, 95)).result.ruleId).toBe("BP-G2");
  });
});
