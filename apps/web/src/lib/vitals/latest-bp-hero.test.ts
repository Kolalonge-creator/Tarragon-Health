import { buildLatestBpHero } from "./latest-bp-hero";

const NOW = new Date("2026-10-29T12:00:00Z");
const bp = (taken_at: string, systolic: number, diastolic: number, source = "manual") => ({ vital_type: "blood_pressure", systolic, diastolic, taken_at, source });

describe("buildLatestBpHero", () => {
  it("returns null with no blood pressure readings", () => {
    expect(buildLatestBpHero([], NOW)).toBeNull();
    expect(buildLatestBpHero([{ vital_type: "weight", taken_at: "2026-10-28T08:00:00Z" }], NOW)).toBeNull();
  });
  it("uses the newest reading, graded by the shared classifier, and a 7-day average", () => {
    const hero = buildLatestBpHero([bp("2026-10-20T08:00:00Z", 160, 100), bp("2026-10-28T08:00:00Z", 120, 78), bp("2026-10-26T08:00:00Z", 130, 82)], NOW);
    expect(hero?.systolic).toBe(120);
    expect(hero?.status?.level).toBe("green");
    expect(hero?.average).toEqual({ systolic: 125, diastolic: 80, count: 2 });
  });
  it("never uses a wearable estimate as the latest reading or in the average", () => {
    const hero = buildLatestBpHero([bp("2026-10-28T08:00:00Z", 150, 95, "wearable"), bp("2026-10-27T08:00:00Z", 118, 76)], NOW);
    expect(hero?.systolic).toBe(118);
    expect(hero?.average?.count).toBe(1);
  });
  it("has no average when the newest reading is older than a week", () => {
    expect(buildLatestBpHero([bp("2026-10-01T08:00:00Z", 118, 76)], NOW)?.average).toBeNull();
  });
});
