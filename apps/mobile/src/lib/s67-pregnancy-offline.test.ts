/**
 * S67 (16.6, OQ-90 option a, INV-06): the emergency facts the red pregnancy rules need (the pregnant flag and the dating the week is
 * worked out from) are kept ON THE PHONE, so a pregnancy red reading or danger sign fires with no signal at all.
 */
import AsyncStorage from "@react-native-async-storage/async-storage";
import { gradeOnDevice, clearPendingRecheck } from "./triage-device";
import { pregnancyWeekFrom, readObstetricCache, readPregnancyWeek, refreshObstetricStatus } from "./obstetric-status";

let mockThrow = false;
let mockPregnancy: { data: unknown; error: unknown } = { data: null, error: null };
jest.mock("./supabase", () => ({
  supabase: {
    from: (table: string) => {
      if (mockThrow) throw new Error("network request failed");
      if (table === "patient_pregnancy") return { select: () => ({ eq: () => ({ maybeSingle: async () => mockPregnancy }) }) };
      return { select: () => ({ eq: () => ({ order: () => ({ limit: async () => ({ data: [], error: null }) }) }) }) };
    },
    rpc: async () => {
      throw new Error("network request failed");
    },
  },
}));

const SUBJECT = "user-67";
const NOW = Date.parse("2026-10-05T10:00:00.000Z");
const KEY = `@tarragon/obstetric/v1:${SUBJECT}`;
const grade = (systolic: number, diastolic: number, symptoms: string[] = []) =>
  gradeOnDevice({ subjectId: SUBJECT, systolic, diastolic, symptoms: symptoms as never[], symptomsAnswered: true, nowMs: NOW });

beforeEach(async () => {
  mockThrow = false;
  mockPregnancy = { data: null, error: null };
  await AsyncStorage.removeItem(KEY);
  await AsyncStorage.removeItem("@tarragon/triage/rules/v1");
  await clearPendingRecheck(SUBJECT);
});

describe("the pregnancy facts are cached with their dating", () => {
  it("a refresh keeps the flag, the last period and the due date, and the week is worked out on the phone", async () => {
    mockPregnancy = { data: { is_pregnant: true, estimated_due_date: "2026-12-06", last_menstrual_period_date: "2026-03-01" }, error: null };
    expect(await refreshObstetricStatus(SUBJECT, NOW)).toBe("updated");
    const cache = await readObstetricCache(SUBJECT);
    expect(cache).toMatchObject({ pregnant: true, lmp: "2026-03-01", edd: "2026-12-06" });
    expect(await readPregnancyWeek(SUBJECT, NOW)).toBe(31);
  });

  it("is null when she is not pregnant, when there is no dating or when the dating is not a date", () => {
    expect(pregnancyWeekFrom({ pregnant: false, lastDeliveryDate: null, fetchedAtMs: 0, edd: "2026-12-06" }, NOW)).toBeNull();
    expect(pregnancyWeekFrom({ pregnant: true, lastDeliveryDate: null, fetchedAtMs: 0 }, NOW)).toBeNull();
    expect(pregnancyWeekFrom({ pregnant: true, lastDeliveryDate: null, fetchedAtMs: 0, edd: "soon" }, NOW)).toBeNull();
    expect(pregnancyWeekFrom(null, NOW)).toBeNull();
  });

  it("an old copy with no dating still reads (the flag is kept, the week is unknown)", async () => {
    await AsyncStorage.setItem(KEY, JSON.stringify({ pregnant: true, lastDeliveryDate: null, fetchedAtMs: 1 }));
    expect(await readObstetricCache(SUBJECT)).toMatchObject({ pregnant: true, lmp: null, edd: null });
    expect(await readPregnancyWeek(SUBJECT, NOW)).toBeNull();
  });
});

describe("offline (every server call fails): the red pregnancy rules still fire", () => {
  beforeEach(async () => {
    await AsyncStorage.setItem(KEY, JSON.stringify({ pregnant: true, lastDeliveryDate: null, fetchedAtMs: 1, lmp: "2026-03-01", edd: null }));
    mockThrow = true;
  });

  it("150/100 at 30 weeks with a severe headache is an emergency with the guidance", async () => {
    const r = await grade(150, 100, ["severe_headache"]);
    expect(r.result).toMatchObject({ status: "graded", grade: "red", ruleId: "BP-P4" });
    expect(r.severity).toBe("emergency");
    expect(r.emergencyCode).toBe("EMG-001");
  });

  it("160/110 alone is an emergency", async () => {
    expect((await grade(160, 110)).result).toMatchObject({ grade: "red", ruleId: "BP-P3" });
  });

  it("a convulsion with an ordinary reading is an emergency (BP-P6)", async () => {
    const r = await grade(112, 70, ["convulsion"]);
    expect(r.result).toMatchObject({ grade: "red", ruleId: "BP-P6" });
    expect(r.severity).toBe("emergency");
  });

  it("sudden swelling of the face or hands with 140/90 is an emergency", async () => {
    expect((await grade(140, 90, ["sudden_face_hand_swelling"])).result).toMatchObject({ grade: "red", ruleId: "BP-P4" });
  });

  it("the same facts WITHOUT the cache fall back to the adult rules (this is the gap the cache closes)", async () => {
    await AsyncStorage.removeItem(KEY);
    const r = await grade(150, 100, ["severe_headache"]);
    expect(r.result.ruleId).not.toBe("BP-P4");
    expect(r.result.grade).not.toBe("red");
  });
});
