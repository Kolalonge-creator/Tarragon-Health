/**
 * vitals.ts is where a patient's reading meets the offline-first write path
 * and the on-device red-flag check that drives EmergencyGuidanceModal with
 * zero network. Two things here are worth a test more than anything else in
 * this package:
 *
 *  1. the mg/dL -> mmol/L conversion in front of the glucose classifier — a
 *     unit slip puts a "you are fine" or a "go to hospital now" in front of
 *     the wrong patient;
 *  2. that the classifier uses the SYNCED thresholds, not the bundled ones —
 *     otherwise threshold-sync.ts is decorative.
 */
import { NETWORK_ERROR_MESSAGE, postVitalReading, type VitalReadingPayload } from "./api";
import { classifyVitalOffline, computeSevenDayAverage, logBpReading, type BpReading } from "./vitals";
import { syncThresholdsIfOnline } from "./threshold-sync";
import { fetchVitalsThresholds } from "./api";

jest.mock("./api", () => ({
  ...(jest.requireActual("./api") as object),
  postVitalReading: jest.fn(),
  fetchVitalsThresholds: jest.fn(),
}));

const mockPost = postVitalReading as jest.MockedFunction<typeof postVitalReading>;
const mockThresholds = fetchVitalsThresholds as jest.MockedFunction<typeof fetchVitalsThresholds>;

function reading(daysAgo: number, systolic: number, diastolic: number): BpReading {
  return {
    id: `r-${daysAgo}`,
    systolic,
    diastolic,
    takenAt: new Date(Date.now() - daysAgo * 24 * 60 * 60 * 1000).toISOString(),
    level: "green",
  };
}

describe("computeSevenDayAverage", () => {
  it("averages and rounds only the readings inside the window", () => {
    expect(
      computeSevenDayAverage([reading(1, 140, 90), reading(3, 130, 80), reading(20, 200, 120)])
    ).toEqual({ systolic: 135, diastolic: 85, readingCount: 2 });
  });

  it("returns null rather than 0/0 when nothing falls inside the window", () => {
    expect(computeSevenDayAverage([])).toBeNull();
    expect(computeSevenDayAverage([reading(30, 140, 90)])).toBeNull();
  });
});

describe("classifyVitalOffline", () => {
  it("takes over the screen only for a crisis-range BP, and flags a high one as urgent", async () => {
    await expect(
      classifyVitalOffline({ vital_type: "blood_pressure", systolic: 210, diastolic: 130 })
    ).resolves.toMatchObject({ severity: "emergency" });

    await expect(
      classifyVitalOffline({ vital_type: "blood_pressure", systolic: 170, diastolic: 95 })
    ).resolves.toMatchObject({ severity: "urgent" });

    await expect(
      classifyVitalOffline({ vital_type: "blood_pressure", systolic: 138, diastolic: 86 })
    ).resolves.toBeNull();
  });

  it("names the actual reading back to the patient", async () => {
    const flag = await classifyVitalOffline({ vital_type: "blood_pressure", systolic: 210, diastolic: 130 });
    expect(flag?.detail).toContain("210/130");
  });

  const glucoseCases: [number, "mmol_l" | "mg_dl", "emergency" | "urgent" | null][] = [
    [2.5, "mmol_l", "emergency"],
    [45, "mg_dl", "emergency"], // 2.5 mmol/L
    [3.5, "mmol_l", "urgent"],
    [63, "mg_dl", "urgent"], // 3.5 mmol/L
    [22, "mmol_l", "urgent"],
    [400, "mg_dl", "urgent"], // 22.2 mmol/L
    [6.0, "mmol_l", null],
    [108, "mg_dl", null], // 6.0 mmol/L
  ];

  it.each(glucoseCases)("classifies %d %s as %s", async (value, unit, expected) => {
    const payload: VitalReadingPayload = {
      vital_type: "glucose",
      glucose_value: value,
      glucose_unit: unit,
      glucose_context: "random",
    };
    const flag = await classifyVitalOffline(payload);
    expect(flag?.severity ?? null).toBe(expected);
  });

  it("has nothing to say about vitals it has no offline rule for", async () => {
    await expect(classifyVitalOffline({ vital_type: "weight", weight_kg: 74 })).resolves.toBeNull();
    await expect(classifyVitalOffline({ vital_type: "spo2", spo2_pct: 82 })).resolves.toBeNull();
    await expect(classifyVitalOffline({ vital_type: "pulse", pulse_bpm: 180 })).resolves.toBeNull();
  });

  /**
   * The whole point of threshold-sync.ts. If this ever stops holding, a
   * handset keeps classifying on whatever thresholds it shipped with and
   * nothing anywhere reports it.
   */
  it("classifies against the thresholds the server last sent, not the bundled ones", async () => {
    await expect(
      classifyVitalOffline({ vital_type: "blood_pressure", systolic: 190, diastolic: 110 })
    ).resolves.toMatchObject({ severity: "urgent" });

    mockThresholds.mockResolvedValue({
      version: "glucose:2027-01-01.1|bp:2027-01-01.1",
      glucose: {},
      bp: { emergency: { systolic: 185, diastolic: 115 } },
    });
    await syncThresholdsIfOnline();

    await expect(
      classifyVitalOffline({ vital_type: "blood_pressure", systolic: 190, diastolic: 110 })
    ).resolves.toMatchObject({ severity: "emergency" });
  });
});

describe("logBpReading", () => {
  it("reports the reading as synced once the immediate flush lands", async () => {
    mockPost.mockResolvedValue({ success: true });
    await expect(logBpReading(150, 95)).resolves.toMatchObject({ synced: true });
  });

  /**
   * The offline promise: the caller gets a client_reading_id back even when
   * nothing reached the server, so the screen can show "saved, will sync"
   * instead of losing the reading or claiming a false success.
   */
  it("still returns a durable id, marked unsynced, when the device is offline", async () => {
    mockPost.mockResolvedValue({ success: false, error: NETWORK_ERROR_MESSAGE });
    const result = await logBpReading(150, 95);
    expect(result.clientReadingId).toEqual(expect.any(String));
    expect(result.synced).toBe(false);
    expect(result.error).toBeUndefined();
  });
});
