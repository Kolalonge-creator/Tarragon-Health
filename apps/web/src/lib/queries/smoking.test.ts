import { smokeFreeStreak } from "./smoking";
import type { SmokingCheckIn } from "./smoking";

function checkIn(logged_on: string, cigarettes_smoked: number): SmokingCheckIn {
  return {
    id: logged_on,
    organisation_id: "org",
    patient_id: "patient",
    logged_on,
    cigarettes_smoked,
    cravings_intensity: null,
    triggers: [],
    note: null,
    created_at: `${logged_on}T00:00:00Z`,
  };
}

describe("smokeFreeStreak", () => {
  it("returns 0 when there are no check-ins", () => {
    expect(smokeFreeStreak([])).toBe(0);
  });

  it("counts consecutive smoke-free days back from the most recent", () => {
    const rows = [
      checkIn("2026-08-25", 3),
      checkIn("2026-08-26", 0),
      checkIn("2026-08-27", 0),
      checkIn("2026-08-28", 0),
    ];
    expect(smokeFreeStreak(rows)).toBe(3);
  });

  it("stops counting at the first non-zero day, even out of order input", () => {
    const rows = [checkIn("2026-08-28", 0), checkIn("2026-08-26", 2), checkIn("2026-08-27", 0)];
    expect(smokeFreeStreak(rows)).toBe(2);
  });

  it("is 0 when the most recent day wasn't smoke-free", () => {
    const rows = [checkIn("2026-08-27", 0), checkIn("2026-08-28", 1)];
    expect(smokeFreeStreak(rows)).toBe(0);
  });
});
