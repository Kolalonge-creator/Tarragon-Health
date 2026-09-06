import { describe, expect, it } from "@jest/globals";
import { ageMs, slaBadgeVariant, slaLabel, timeAgo } from "./sla-label";

const NOW = Date.parse("2026-09-05T12:00:00.000Z");
const minutesFromNow = (mins: number) => new Date(NOW + mins * 60_000).toISOString();

describe("slaLabel", () => {
  it("returns null when a row carries no SLA at all", () => {
    // A manually raised escalation has no clinician_alert, so no sla_due_at.
    // That must never render as "on time".
    expect(slaLabel(null, NOW)).toBeNull();
    expect(slaLabel(undefined, NOW)).toBeNull();
  });

  it("counts down in minutes inside the hour", () => {
    expect(slaLabel(minutesFromNow(43), NOW)).toEqual({
      text: "43m left",
      overdue: false,
      imminent: true,
    });
  });

  it("counts down in hours, then days", () => {
    expect(slaLabel(minutesFromNow(150), NOW)?.text).toBe("3h left");
    expect(slaLabel(minutesFromNow(60 * 50), NOW)?.text).toBe("2d left");
  });

  it("says how long a breached SLA has been breached, not just that it is", () => {
    expect(slaLabel(minutesFromNow(-120), NOW)).toEqual({
      text: "2h overdue",
      overdue: true,
      imminent: false,
    });
  });

  it("distinguishes a case ten minutes from breaching from one with a day left", () => {
    const soon = slaLabel(minutesFromNow(10), NOW)!;
    const later = slaLabel(minutesFromNow(60 * 20), NOW)!;
    expect(soon.imminent).toBe(true);
    expect(later.imminent).toBe(false);
    expect(soon.text).not.toBe(later.text);
  });
});

describe("slaBadgeVariant", () => {
  it("is red once breached, amber in the final hour, grey otherwise", () => {
    expect(slaBadgeVariant(slaLabel(minutesFromNow(-1), NOW)!)).toBe("red");
    expect(slaBadgeVariant(slaLabel(minutesFromNow(30), NOW)!)).toBe("amber");
    expect(slaBadgeVariant(slaLabel(minutesFromNow(300), NOW)!)).toBe("grey");
  });
});

describe("timeAgo", () => {
  it("phrases waits at each scale", () => {
    expect(timeAgo(minutesFromNow(0), NOW)).toBe("just now");
    expect(timeAgo(minutesFromNow(-12), NOW)).toBe("12m ago");
    expect(timeAgo(minutesFromNow(-90), NOW)).toBe("1h ago");
    expect(timeAgo(minutesFromNow(-60 * 50), NOW)).toBe("2d ago");
  });
});

describe("ageMs", () => {
  it("measures how long a row has waited", () => {
    expect(ageMs(minutesFromNow(-30), NOW)).toBe(30 * 60_000);
  });
});
