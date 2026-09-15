import { describe, expect, it } from "@jest/globals";
import {
  compareThreads,
  formatWait,
  isAwaitingCareTeam,
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
