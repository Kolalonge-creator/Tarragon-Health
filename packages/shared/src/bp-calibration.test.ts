import { describe, expect, it } from "@jest/globals";
import { cufflessCalibration, latestCuffCheckAt, type CufflessCalibrationConfig } from "./bp-estimate";
import { getProposedConfig } from "./proposed-config";

const cfg = getProposedConfig("bp.cuffless_calibration").value as unknown as CufflessCalibrationConfig;
const now = new Date("2026-10-22T12:00:00Z");
const ago = (days: number) => new Date(now.getTime() - days * 86_400_000).toISOString();

describe("cuffless blood pressure calibration label (S70b)", () => {
  it("the day counts are PROPOSED, CMO owned and unsigned, and default to 28 and 7", () => {
    const e = getProposedConfig("bp.cuffless_calibration");
    expect(e.status).toBe("proposed");
    expect(e.owner).toBe("CMO");
    expect(cfg).toEqual({ staleAfterDays: 28, cuffCheckWithinDays: 7 });
  });

  it("never checked when there is no cuff reading, or the date cannot be read", () => {
    expect(cufflessCalibration(null, now, cfg)).toEqual({ kind: "never" });
    expect(cufflessCalibration(undefined, now, cfg)).toEqual({ kind: "never" });
    expect(cufflessCalibration("not a date", now, cfg)).toEqual({ kind: "never" });
  });

  it("checked up to and including the limit, stale one day after", () => {
    expect(cufflessCalibration(ago(0), now, cfg).kind).toBe("checked");
    expect(cufflessCalibration(ago(cfg.staleAfterDays), now, cfg)).toMatchObject({ kind: "checked", daysAgo: cfg.staleAfterDays });
    expect(cufflessCalibration(ago(cfg.staleAfterDays + 1), now, cfg)).toMatchObject({ kind: "stale", daysAgo: cfg.staleAfterDays + 1 });
  });

  it("follows the configured number, not a literal", () => {
    expect(cufflessCalibration(ago(10), now, { staleAfterDays: 9, cuffCheckWithinDays: 7 }).kind).toBe("stale");
    expect(cufflessCalibration(ago(10), now, { staleAfterDays: 11, cuffCheckWithinDays: 7 }).kind).toBe("checked");
  });

  it("a date in the future (a wrong clock) is today, never a negative number of days", () => {
    expect(cufflessCalibration(ago(-3), now, cfg)).toMatchObject({ kind: "checked", daysAgo: 0 });
  });

  it("the last cuff check is the newest reading that is not an estimate", () => {
    const rows = [
      { source: "wearable", takenAt: ago(1) },
      { source: "manual", takenAt: ago(9) },
      { source: "device", takenAt: ago(5) },
      { source: "pharmacy", takenAt: ago(7) },
      { source: null, takenAt: ago(30) },
      { source: "manual", takenAt: "garbage" },
    ];
    expect(latestCuffCheckAt(rows)).toBe(ago(5));
    expect(latestCuffCheckAt([{ source: "wearable", takenAt: ago(1) }])).toBeNull();
    expect(latestCuffCheckAt([])).toBeNull();
  });
});
