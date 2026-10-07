/**
 * S85-D1: the phone asks the emergency-symptom question where the APPROVED rule set says to, not at a number written in the app.
 * Version 4 (a draft, founder decision D1, unsigned by the CMO) moves the line from 200/130 to 180/120. Nothing here approves anything:
 * the "approved" status is set on a cached copy inside the test, the way the phone caches a set the server approved.
 */
import AsyncStorage from "@react-native-async-storage/async-storage";
import { BP_CARE_V1, BP_CARE_V3, BP_CARE_V4 } from "@tarragon/clinical";
import { discardRejectedRow, flushOutbox, listOutbox } from "./outbox";
import { clearPendingRecheck, gradeOnDevice, loadDeviceRuleSet, shouldAskSymptomQuestion } from "./triage-device";

jest.mock("./supabase", () => ({
  supabase: {
    auth: { getSession: async () => ({ data: { session: { user: { id: "user-1" } } } }) },
    rpc: async () => ({ data: null, error: null }),
    from: () => ({
      select: () => ({ eq: () => ({ single: async () => ({ data: { organisation_id: "org-1" }, error: null }) }) }),
      insert: async () => ({ error: null }),
    }),
  },
}));
jest.mock("./offline-store", () => ({ ...(jest.requireActual("./offline-store") as object), readLocalRecords: async () => [] }));

const SUBJECT = "user-1";
const NOW = Date.parse("2026-10-05T10:00:00.000Z");
const RULES_KEY = "@tarragon/triage/rules/v1";
const cache = (set: object) => AsyncStorage.setItem(RULES_KEY, JSON.stringify({ ...set, status: "approved" }));
const grade = (systolic: number, diastolic: number, over: Partial<Parameters<typeof gradeOnDevice>[0]> = {}) =>
  gradeOnDevice({ subjectId: SUBJECT, systolic, diastolic, symptoms: [], nowMs: NOW, ...over });

beforeEach(async () => {
  await flushOutbox();
  for (const row of await listOutbox()) await discardRejectedRow(row.clientId);
  await clearPendingRecheck(SUBJECT);
  await AsyncStorage.removeItem(RULES_KEY);
});

describe("the question line comes from the cached approved rule set", () => {
  it("under a cached v4: 180/120 and either number alone ask the question; 179/119 does not", async () => {
    await cache(BP_CARE_V4);
    for (const [s, d] of [[180, 120], [190, 100], [150, 120], [200, 130]] as const) {
      const out = await grade(s, d);
      expect([s, d, out.result.status, out.result.ruleId, shouldAskSymptomQuestion(out)]).toEqual([s, d, "symptom_check_required", "BP-X1", true]);
    }
    const below = await grade(179, 119);
    expect(below.result.status).not.toBe("symptom_check_required");
    expect(shouldAskSymptomQuestion(below)).toBe(false);
  });

  it("the very same reading asks under v4 and not under v3 (the line is data, not a constant)", async () => {
    await cache(BP_CARE_V3);
    expect(shouldAskSymptomQuestion(await grade(190, 100))).toBe(false);
    await cache(BP_CARE_V4);
    expect(shouldAskSymptomQuestion(await grade(190, 100))).toBe(true);
  });

  it("under v4 a ticked symptom is RED with emergency guidance, and the answer 'none' starts the 2 hour recheck", async () => {
    await cache(BP_CARE_V4);
    const red = await grade(190, 120, { symptoms: ["severe_headache"] });
    expect(red.result).toMatchObject({ grade: "red", ruleId: "BP-R1" });
    expect(red.severity).toBe("emergency");
    expect(red.emergencyCode).toBe("EMG-001");
    const none = await grade(190, 120, { symptomsAnswered: true });
    expect(none.result).toMatchObject({ status: "recheck_required", ruleId: "BP-X2" });
    expect(none.result.recheck?.waitMinutes).toBe(120);
  });

  it("a normal reading never asks (pregnancy parity with the server is pinned in packages/clinical, bp-care-v4.test.ts)", async () => {
    await cache(BP_CARE_V4);
    expect(shouldAskSymptomQuestion(await grade(120, 78))).toBe(false);
  });
});

describe("what a phone with no approved copy does", () => {
  it("falls back to the bundled draft (v2, 200/130), never to the unsigned v4", async () => {
    const { ruleSet, status } = await loadDeviceRuleSet();
    expect(status).toBe("draft");
    expect(ruleSet.version).toBe(BP_CARE_V1.version);
    expect(ruleSet.version).not.toBe(BP_CARE_V4.version);
    expect(ruleSet.params.extreme).toEqual({ systolic: 200, diastolic: 130 });
    // a draft never shows the question, so the older on-device check keeps deciding the band until a set is approved
    expect(shouldAskSymptomQuestion(await grade(190, 125))).toBe(false);
  });
});
