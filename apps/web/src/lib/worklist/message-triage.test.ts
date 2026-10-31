import { describe, expect, it } from "@jest/globals";
import {
  compareThreads,
  formatWait,
  isAwaitingCareTeam,
  isOlderUnanswered,
  isPastReplyTarget,
  REPLY_LOOKBACK_DAYS,
  waitingMs,
  type TriageableThread,
} from "./message-triage";

const NOW = Date.parse("2026-09-05T12:00:00.000Z");
const at = (mins: number) => new Date(NOW + mins * 60_000).toISOString();

function thread(overrides: Partial<TriageableThread> = {}): TriageableThread {
  return {
    status: "open",
    last_message_at: at(-60),
    last_message_author_role: "patient",
    care_team_last_read_at: null,
    ...overrides,
  };
}

describe("isAwaitingCareTeam", () => {
  it("is true for a patient message nobody has opened", () => {
    expect(isAwaitingCareTeam(thread())).toBe(true);
  });

  it("is true for a sponsor message too", () => {
    expect(isAwaitingCareTeam(thread({ last_message_author_role: "sponsor" }))).toBe(true);
  });

  it("is false once a staff member has read it after the last message", () => {
    expect(
      isAwaitingCareTeam(thread({ care_team_last_read_at: at(-30) }))
    ).toBe(false);
  });

  it("is true again when a newer patient message lands after the last read", () => {
    expect(
      isAwaitingCareTeam(thread({ last_message_at: at(-10), care_team_last_read_at: at(-30) }))
    ).toBe(true);
  });

  it("is false when the care team spoke last, however long ago", () => {
    expect(
      isAwaitingCareTeam(thread({ last_message_author_role: "care_team", last_message_at: at(-60 * 24 * 30) }))
    ).toBe(false);
  });

  it("is false on a closed thread", () => {
    expect(isAwaitingCareTeam(thread({ status: "closed" }))).toBe(false);
  });
});

describe("waitingMs", () => {
  it("measures the wait only for threads that owe a reply", () => {
    expect(waitingMs(thread({ last_message_at: at(-90) }), NOW)).toBe(90 * 60_000);
    expect(waitingMs(thread({ last_message_author_role: "care_team" }), NOW)).toBeNull();
  });
});

describe("formatWait", () => {
  it("phrases a wait as a duration", () => {
    expect(formatWait(30_000)).toBe("just now");
    expect(formatWait(45 * 60_000)).toBe("45m");
    expect(formatWait(5 * 60 * 60_000)).toBe("5h");
    expect(formatWait(50 * 60 * 60_000)).toBe("2d");
  });
});

describe("compareThreads", () => {
  it("puts the longest-waiting unanswered thread first, not the most recently answered", () => {
    const justAnswered = thread({
      last_message_author_role: "care_team",
      last_message_at: at(-1),
    });
    const waitingSinceTuesday = thread({ last_message_at: at(-60 * 24 * 3) });
    const waitingAnHour = thread({ last_message_at: at(-60) });

    const sorted = [justAnswered, waitingAnHour, waitingSinceTuesday].sort(compareThreads);
    expect(sorted).toEqual([waitingSinceTuesday, waitingAnHour, justAnswered]);
  });

  it("never sorts a closed thread above an open one", () => {
    const closed = thread({ status: "closed", last_message_at: at(-1) });
    const openAnswered = thread({
      last_message_author_role: "care_team",
      last_message_at: at(-60 * 24),
    });
    expect([closed, openAnswered].sort(compareThreads)).toEqual([openAnswered, closed]);
  });

  it("falls back to most recent activity among threads that owe nothing", () => {
    const older = thread({ last_message_author_role: "care_team", last_message_at: at(-600) });
    const newer = thread({ last_message_author_role: "care_team", last_message_at: at(-10) });
    expect([older, newer].sort(compareThreads)).toEqual([newer, older]);
  });
});

describe("isPastReplyTarget", () => {
  const now = new Date("2026-10-31T12:00:00Z").getTime();
  const open = { status: "open", last_message_author_role: "patient" };
  it("is past once the patient has waited longer than the target", () => {
    expect(isPastReplyTarget({ ...open, last_message_at: "2026-10-30T11:00:00Z" }, 24, now)).toBe(true);
    expect(isPastReplyTarget({ ...open, last_message_at: "2026-10-30T13:00:00Z" }, 24, now)).toBe(false);
  });
  it("stays past even if someone opened the thread, and clears on a care-team reply or closing", () => {
    expect(isPastReplyTarget({ ...open, last_message_at: "2026-10-29T00:00:00Z" }, 24, now)).toBe(true);
    expect(isPastReplyTarget({ status: "open", last_message_author_role: "care_team", last_message_at: "2026-10-29T00:00:00Z" }, 24, now)).toBe(false);
    expect(isPastReplyTarget({ status: "closed", last_message_author_role: "patient", last_message_at: "2026-10-29T00:00:00Z" }, 24, now)).toBe(false);
  });
});

describe("the 14 day lookback on the reply-target badge", () => {
  const now = new Date("2026-10-31T12:00:00Z").getTime();
  const open = { status: "open", last_message_author_role: "patient" };
  it("is the configured 14 days", () => {
    expect(REPLY_LOOKBACK_DAYS).toBe(14);
  });
  it("badges a wait inside the lookback but not one older than it", () => {
    expect(isPastReplyTarget({ ...open, last_message_at: "2026-10-20T12:00:00Z" }, 24, now)).toBe(true); // 11 days
    expect(isPastReplyTarget({ ...open, last_message_at: "2026-10-16T12:00:00Z" }, 24, now)).toBe(false); // 15 days
  });
  it("counts an older patient-last conversation quietly, and nothing else", () => {
    expect(isOlderUnanswered({ ...open, last_message_at: "2026-10-16T12:00:00Z" }, now)).toBe(true);
    expect(isOlderUnanswered({ ...open, last_message_at: "2026-10-20T12:00:00Z" }, now)).toBe(false);
    expect(isOlderUnanswered({ status: "open", last_message_author_role: "care_team", last_message_at: "2026-09-01T00:00:00Z" }, now)).toBe(false);
    expect(isOlderUnanswered({ status: "open", last_message_author_role: null, last_message_at: "2026-09-01T00:00:00Z" }, now)).toBe(false);
    expect(isOlderUnanswered({ status: "closed", last_message_author_role: "patient", last_message_at: "2026-09-01T00:00:00Z" }, now)).toBe(false);
  });
  it("a thread is either badged or counted as older, never both", () => {
    for (const days of [1, 5, 14, 15, 40]) {
      const t = { ...open, last_message_at: new Date(now - days * 86_400_000).toISOString() };
      expect(isPastReplyTarget(t, 24, now) && isOlderUnanswered(t, now)).toBe(false);
    }
  });
});
