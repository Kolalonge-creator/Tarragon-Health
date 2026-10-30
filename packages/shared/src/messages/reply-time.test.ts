import { describe, expect, it } from "@jest/globals";
import { parseReplyTime, replyTimePhrase, replyTimeSentence } from "./reply-time";

describe("parseReplyTime", () => {
  it("reads an available figure", () => {
    expect(parseReplyTime({ available: true, median_minutes: 180, replies: 14, window_days: 30 })).toEqual({ medianMinutes: 180, replies: 14, windowDays: 30 });
  });
  it("is no figure for not available, errors, nulls and malformed answers", () => {
    for (const v of [{ available: false }, null, undefined, [], "x", { available: true }, { available: true, median_minutes: "9", replies: 12, window_days: 30 }, { available: true, median_minutes: -1, replies: 12, window_days: 30 }, { available: true, median_minutes: NaN, replies: 12, window_days: 30 }]) {
      expect(parseReplyTime(v)).toBeNull();
    }
  });
});

describe("replyTimePhrase", () => {
  it("rounds to a plain phrase", () => {
    expect(replyTimePhrase(2)).toBe("about 5 minutes");
    expect(replyTimePhrase(42)).toBe("about 40 minutes");
    expect(replyTimePhrase(75)).toBe("about an hour");
    expect(replyTimePhrase(180)).toBe("about 3 hours");
    expect(replyTimePhrase(24 * 60)).toBe("about a day");
    expect(replyTimePhrase(3 * 24 * 60)).toBe("about 3 days");
  });
  it("the sentence says it is not a promise and carries no dash", () => {
    const s = replyTimeSentence({ medianMinutes: 180, replies: 14, windowDays: 30 });
    expect(s).toContain("not a promise");
    expect(s).not.toMatch(/[—–]/);
  });
});
