import { consultState } from "./my-outreach-checks";
import { isOutreachDay, screeningDayKind, screeningDayReadyForAttendees } from "@/lib/queries/screening-days";

describe("consultState (the one results consultation a paid outreach place includes)", () => {
  const now = new Date("2026-11-04T10:00:00Z");

  it("is none for a free place", () => {
    expect(consultState(null, now)).toBe("none");
    expect(consultState(undefined, now)).toBe("none");
  });

  it("is ready while active, unspent and in date", () => {
    expect(consultState({ status: "active", redeemed_at: null, expires_at: "2026-12-30T00:00:00Z" }, now)).toBe("ready");
  });

  it("is used once spent, whatever its status", () => {
    expect(consultState({ status: "active", redeemed_at: "2026-11-10T00:00:00Z", expires_at: null }, now)).toBe("used");
  });

  it("is lapsed once past its date or no longer active", () => {
    expect(consultState({ status: "active", redeemed_at: null, expires_at: "2026-11-01T00:00:00Z" }, now)).toBe("lapsed");
    expect(consultState({ status: "expired", redeemed_at: null, expires_at: null }, now)).toBe("lapsed");
  });
});

describe("screening day kinds", () => {
  it("treats anything unknown as the original bundle day", () => {
    expect(screeningDayKind({ kind: "bundle" })).toBe("bundle");
    expect(screeningDayKind({ kind: "something_else" })).toBe("bundle");
    expect(isOutreachDay({ kind: "outreach_paid" })).toBe(true);
    expect(isOutreachDay({ kind: "bundle" })).toBe(false);
  });

  it("opens a free day to attendees with no payment at all", () => {
    expect(screeningDayReadyForAttendees({ kind: "outreach_free", total_kobo: null, amount_paid_kobo: 0 })).toBe(true);
  });

  it("holds a paid outreach day and a bundle day until paid in full", () => {
    expect(screeningDayReadyForAttendees({ kind: "outreach_paid", total_kobo: 3_000_000, amount_paid_kobo: 1_500_000 })).toBe(false);
    expect(screeningDayReadyForAttendees({ kind: "outreach_paid", total_kobo: 3_000_000, amount_paid_kobo: 3_000_000 })).toBe(true);
    expect(screeningDayReadyForAttendees({ kind: "bundle", total_kobo: null, amount_paid_kobo: 0 })).toBe(false);
  });
});
