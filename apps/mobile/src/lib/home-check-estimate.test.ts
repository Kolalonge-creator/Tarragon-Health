/**
 * A wearable (cuffless) blood pressure estimate must never count toward the seven-day home check: the server counts cuff readings only, so a phone
 * that counted an estimate would show "complete" while the server answers "not enough readings".
 */
import { toHomeReadings } from "./home-check";

jest.mock("./supabase", () => ({ supabase: { auth: { getSession: async () => ({ data: { session: null } }) }, rpc: jest.fn() } }));
jest.mock("@react-native-async-storage/async-storage", () => ({ getItem: jest.fn(), setItem: jest.fn(), removeItem: jest.fn() }));

const at = (iso: string) => iso;

describe("toHomeReadings", () => {
  it("drops a wearable estimate and keeps cuff readings, with or without a known source", () => {
    const out = toHomeReadings([
      { systolic: 150, diastolic: 95, takenAt: at("2026-10-10T07:00:00Z"), source: "wearable" },
      { systolic: 130, diastolic: 82, takenAt: at("2026-10-10T07:02:00Z"), source: "manual" },
      { systolic: 128, diastolic: 80, takenAt: at("2026-10-10T07:04:00Z"), source: "device" },
      { systolic: 126, diastolic: 78, takenAt: at("2026-10-10T07:06:00Z") },
    ]);
    expect(out.map((r) => r.systolic)).toEqual([130, 128, 126]);
  });

  it("drops a reading with an unreadable time", () => {
    expect(toHomeReadings([{ systolic: 130, diastolic: 80, takenAt: "not a date", source: "manual" }])).toEqual([]);
  });
});
