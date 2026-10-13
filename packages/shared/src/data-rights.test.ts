import { describe, expect, it } from "@jest/globals";
import { DELETION_KEPT, deletionGraceDays, deletionGraceEndsAt, deletionRequestView, exportRequestView, receiptSentence } from "./data-rights";

const DAY = 24 * 60 * 60 * 1000;
const NOW = Date.parse("2026-10-13T10:00:00Z");

describe("deletionRequestView", () => {
  const base = { requested_at: "2026-10-13T09:00:00Z" };
  it("waits during the grace period and can be cancelled", () => {
    const v = deletionRequestView({ ...base, status: "pending", grace_ends_at: new Date(NOW + 3 * DAY).toISOString() }, NOW);
    expect(v.phase).toBe("waiting");
    expect(v.canCancel).toBe(true);
    expect(v.daysLeft).toBe(3);
  });
  it("cannot be cancelled once the grace period has ended (the database refuses too)", () => {
    const v = deletionRequestView({ ...base, status: "under_review", grace_ends_at: new Date(NOW - 1000).toISOString() }, NOW);
    expect(v.phase).toBe("in_review");
    expect(v.canCancel).toBe(false);
  });
  it("a request with no grace period (older than this feature) is never offered a cancel button", () => {
    expect(deletionRequestView({ ...base, status: "pending", grace_ends_at: null }, NOW).canCancel).toBe(false);
  });
  it("closed states offer no cancel", () => {
    for (const status of ["completed", "cancelled", "denied"]) {
      expect(deletionRequestView({ ...base, status, grace_ends_at: new Date(NOW + DAY).toISOString() }, NOW).canCancel).toBe(false);
    }
  });
  it("the grace sent with a request is the proposed 14 days", () => {
    expect(deletionGraceDays()).toBe(14);
    expect(Date.parse(deletionGraceEndsAt(NOW)) - NOW).toBe(14 * DAY);
  });
  it("says plainly that clinical records, the audit log and the ledger are kept", () => {
    const text = DELETION_KEPT.join(" ").toLowerCase();
    expect(text).toContain("clinical records");
    expect(text).toContain("audit log");
    expect(text).toContain("ledger");
  });
});

describe("cancelled requests say who cancelled", () => {
  const base = { requested_at: "2026-10-13T09:00:00Z", grace_ends_at: null, patient_id: "p1" };
  it("the person", () => expect(deletionRequestView({ ...base, status: "cancelled", cancelled_by: "p1" }, NOW).headline).toBe("You cancelled this request"));
  it("our team", () => expect(deletionRequestView({ ...base, status: "cancelled", cancelled_by: "admin1" }, NOW).headline).toBe("Our team cancelled this request"));
});

describe("exportRequestView", () => {
  const base = { requested_at: "2026-10-01T09:00:00Z", due_at: "2026-10-31T09:00:00Z" };
  it("states the timeline while waiting", () => {
    const v = exportRequestView({ ...base, status: "pending", fulfilled_at: null }, NOW);
    expect(v.phase).toBe("waiting");
    expect(v.canDownload).toBe(false);
    expect(v.detail).toContain("31 Oct 2026");
  });
  it("is downloadable inside the review window and expires after it", () => {
    const fulfilled = new Date(NOW - 10 * DAY).toISOString();
    expect(exportRequestView({ ...base, status: "fulfilled", fulfilled_at: fulfilled }, NOW).canDownload).toBe(true);
    const old = new Date(NOW - 31 * DAY).toISOString();
    const v = exportRequestView({ ...base, status: "fulfilled", fulfilled_at: old }, NOW);
    expect(v.phase).toBe("expired");
    expect(v.canDownload).toBe(false);
  });
  it("a declined request is not downloadable", () => {
    expect(exportRequestView({ ...base, status: "denied", fulfilled_at: null }, NOW).phase).toBe("declined");
  });
});

describe("receiptSentence", () => {
  const row = { title: "Use my information in approved research", version: "2026-10-07", recorded_at: "2026-10-12T09:00:00Z" };
  it("names who, what, which version, when and where", () => {
    const s = receiptSentence({ ...row, action: "accepted", channel: "mobile", consented_by_relation: "self" });
    expect(s).toBe('You agreed to "Use my information in approved research" (version 2026-10-07) on 12 Oct 2026, in the app.');
  });
  it("does not present a row recorded before receipts as the person's own act", () => {
    const s = receiptSentence({ ...row, action: "accepted", channel: "unknown", consented_by_relation: "legacy" });
    expect(s).toContain("A record from 12 Oct 2026 shows");
    expect(s).toContain("was not recorded at the time");
    expect(s).not.toContain("You agreed");
  });
  it("shows a guardian and a withdrawal, and does not guess an unknown channel", () => {
    const s = receiptSentence({ ...row, action: "withdrawn", channel: "unknown", consented_by_relation: "guardian" });
    expect(s).toContain("A guardian on your behalf withdrew");
    expect(s).toContain("was not kept");
  });
});
