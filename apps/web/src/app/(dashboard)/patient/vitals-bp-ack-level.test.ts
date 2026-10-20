/**
 * The band the form uses to pick its acknowledgement (docs/design/BP-immediate-acknowledgement.md) is returned only for a blood pressure reading that is
 * known to be stored, and is "unknown" (no band wording) when the safety check did not finish.
 */

jest.mock("@/lib/acting/acting-for", () => ({
  resolveSubjectId: jest.fn().mockResolvedValue("patient-1"),
  assertNotActingFor: jest.fn(),
}));
jest.mock("next/cache", () => ({ revalidatePath: jest.fn() }));
jest.mock("@sentry/nextjs", () => ({ captureException: jest.fn() }));
jest.mock("@/lib/vitals/assess-heart-rate", () => ({ assessHeartRateBestEffort: jest.fn() }));
const assessBp = jest.fn();
jest.mock("@/lib/ml/assess-bp-control", () => ({ assessBpControlBestEffort: (...a: unknown[]) => assessBp(...a) }));
jest.mock("@/lib/vitals/assess-glucose", () => ({ assessGlucoseBestEffort: jest.fn() }));
jest.mock("@/lib/health-score/assess-health-score", () => ({ assessHealthScoreBestEffort: jest.fn() }));
jest.mock("@/lib/lifestyle/weekly-plan-progress", () => ({ recordWeeklyPlanProgress: jest.fn() }));

let holdModuleOn = false;
let storedRows: unknown[] = [{ id: "r1" }];
const single = jest.fn();

jest.mock("@/lib/supabase/server", () => ({
  createClient: jest.fn().mockResolvedValue({
    auth: { getUser: jest.fn().mockResolvedValue({ data: { user: { id: "patient-1" } } }) },
    from: (table: string) => {
      if (table === "profiles") return { select: () => ({ eq: () => ({ single }) }) };
      if (table === "platform_modules") {
        return { select: () => ({ in: async () => ({ data: [{ key: "device_plausibility_hold", is_enabled: holdModuleOn }], error: null }) }) };
      }
      if (table === "vitals_readings_held") {
        return { select: () => ({ eq: () => ({ eq: () => ({ gte: () => ({ limit: async () => ({ data: [], error: null }) }) }) }) }) };
      }
      if (table === "vitals_readings") {
        const result = { error: null, data: storedRows };
        return { insert: () => ({ select: async () => result, then: (res: (v: unknown) => unknown) => Promise.resolve({ error: null }).then(res) }) };
      }
      throw new Error(`unexpected table ${table}`);
    },
  }),
}));

import { logVital } from "./actions";

function bpForm(sys: string, dia: string) {
  const fd = new FormData();
  fd.set("vital_type", "blood_pressure");
  fd.set("systolic", sys);
  fd.set("diastolic", dia);
  return fd;
}

beforeEach(() => {
  holdModuleOn = false;
  storedRows = [{ id: "r1" }];
  single.mockResolvedValue({ data: { organisation_id: "org-1" } });
  assessBp.mockReset();
  assessBp.mockResolvedValue(undefined);
});

describe("logVital: the acknowledgement band", () => {
  it("a saved blood pressure returns its display band", async () => {
    expect((await logVital(undefined, bpForm("120", "78")))?.bpAckLevel).toBe("green");
    expect((await logVital(undefined, bpForm("150", "92")))?.bpAckLevel).toBe("amber");
    expect((await logVital(undefined, bpForm("165", "102")))?.bpAckLevel).toBe("red");
    expect((await logVital(undefined, bpForm("205", "110")))?.bpAckLevel).toBe("emergency");
  });

  it("another vital returns no band", async () => {
    const fd = new FormData();
    fd.set("vital_type", "pulse");
    fd.set("pulse_bpm", "72");
    const r = await logVital(undefined, fd);
    expect(r?.success).toBe(true);
    expect(r?.bpAckLevel).toBeUndefined();
  });

  it("when the safety check did not finish, no band wording: unknown, with the honest error beside it", async () => {
    assessBp.mockRejectedValue(new TypeError("fetch failed"));
    const r = await logVital(undefined, bpForm("120", "78"));
    expect(r).toMatchObject({ success: true, bpAckLevel: "unknown" });
    expect(r?.error).toMatch(/could not finish checking/i);
  });

  it("with the plausibility hold on and no row stored, it never says received (no band at all)", async () => {
    holdModuleOn = true;
    storedRows = [];
    const r = await logVital(undefined, bpForm("120", "78"));
    expect(r?.bpAckLevel).toBeUndefined();
  });

  it("with the plausibility hold on and the row stored, it still says received", async () => {
    holdModuleOn = true;
    storedRows = [{ id: "r1" }];
    expect((await logVital(undefined, bpForm("150", "92")))?.bpAckLevel).toBe("amber");
  });
});
