import { en, pcm } from "@tarragon/i18n";
import { DAY_KEYS, daysSummary, describeUpcoming } from "./reminder-format";
import { lagosTimeToUtcMs } from "./lagos-date";

describe("daysSummary", () => {
  it("says every day for null and for all seven", () => {
    expect(daysSummary(null)).toEqual({ everyDay: true });
    expect(daysSummary([0, 1, 2, 3, 4, 5, 6])).toEqual({ everyDay: true });
  });

  it("lists chosen days Monday first, Sunday last", () => {
    expect(daysSummary([0, 3, 1])).toEqual({ everyDay: false, keys: ["reminders.day.1", "reminders.day.3", "reminders.day.0"] });
  });
});

describe("describeUpcoming", () => {
  it("describes a notification in Lagos time, not the phone's", () => {
    const at = lagosTimeToUtcMs("2026-10-05", "08:30") as number; // a Monday
    expect(describeUpcoming({ identifier: "x", notifyAtMs: at, dueAtMs: at })).toEqual({
      weekdayKey: "reminders.day.1",
      date: "05/10",
      time: "08:30",
    });
  });

  it("uses the Lagos day around midnight", () => {
    const at = Date.parse("2026-10-04T23:30:00Z"); // 00:30 on Monday 5 Oct in Lagos
    expect(describeUpcoming({ identifier: "x", notifyAtMs: at, dueAtMs: at })).toMatchObject({
      weekdayKey: "reminders.day.1",
      date: "05/10",
      time: "00:30",
    });
  });
});

describe("day keys", () => {
  it.each(DAY_KEYS.map((k) => [k]))("%s exists in English and Pidgin", (key) => {
    expect((en as Record<string, string>)[key]).toBeTruthy();
    expect((pcm as Record<string, string>)[key]).toBeTruthy();
  });
});
