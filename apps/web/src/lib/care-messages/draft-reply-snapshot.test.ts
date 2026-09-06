import { describe, expect, it } from "@jest/globals";
import { formatDraftReplySnapshotForPrompt, type DraftReplySnapshot } from "./draft-reply-snapshot";

function snapshot(overrides: Partial<DraftReplySnapshot> = {}): DraftReplySnapshot {
  return {
    threadSubject: "Missed my BP reading this week",
    messages: [
      { authorRole: "patient", body: "Sorry, I've been travelling", createdAt: "2026-08-20T10:00:00.000Z" },
    ],
    ...overrides,
  };
}

describe("formatDraftReplySnapshotForPrompt", () => {
  it("includes the thread subject", () => {
    const text = formatDraftReplySnapshotForPrompt(snapshot());
    expect(text).toContain("Missed my BP reading this week");
  });

  it("says plainly when there are no messages yet, rather than omitting the line", () => {
    const text = formatDraftReplySnapshotForPrompt(snapshot({ messages: [] }));
    expect(text).toContain("No messages in this thread yet.");
  });

  it("labels each speaker by role and preserves oldest-first order", () => {
    const text = formatDraftReplySnapshotForPrompt(
      snapshot({
        messages: [
          { authorRole: "patient", body: "First message", createdAt: "2026-08-20T10:00:00.000Z" },
          { authorRole: "care_team", body: "Second message", createdAt: "2026-08-20T11:00:00.000Z" },
          { authorRole: "sponsor", body: "Third message", createdAt: "2026-08-20T12:00:00.000Z" },
        ],
      })
    );
    const firstIndex = text.indexOf("Patient: First message");
    const secondIndex = text.indexOf("Care team: Second message");
    const thirdIndex = text.indexOf("Supporter: Third message");
    expect(firstIndex).toBeGreaterThan(-1);
    expect(secondIndex).toBeGreaterThan(firstIndex);
    expect(thirdIndex).toBeGreaterThan(secondIndex);
  });
});
