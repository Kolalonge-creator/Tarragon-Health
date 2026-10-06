import { describe, expect, it } from "@jest/globals";
import { approveFailureNotice, asNotice, asViewer, lastFullWeek, periodSchema, payoutRowSchema } from "./model";

describe("lastFullWeek", () => {
  it("on a Wednesday gives the Monday to Sunday week before", () => {
    expect(lastFullWeek(new Date("2026-10-07T10:00:00Z"))).toEqual({ start: "2026-09-28", end: "2026-10-04" });
  });
  it("on a Monday gives the week that just ended", () => {
    expect(lastFullWeek(new Date("2026-10-05T08:00:00Z"))).toEqual({ start: "2026-09-28", end: "2026-10-04" });
  });
  it("uses the Lagos date: Sunday 23:30 UTC is already Monday in Lagos", () => {
    expect(lastFullWeek(new Date("2026-10-04T23:30:00Z"))).toEqual({ start: "2026-09-28", end: "2026-10-04" });
  });
});

describe("notices and periods", () => {
  it("only fixed notice tokens are accepted, so an address cannot put its own words on the page", () => {
    expect(asNotice("approved")).toBe("approved");
    expect(asNotice("<b>hi</b>")).toBeNull();
    expect(asNotice(undefined)).toBeNull();
  });
  it("a same-person refusal gets its own notice, anything else is a plain failure", () => {
    expect(approveFailureNotice("payout_same_person")).toBe("same_person");
    expect(approveFailureNotice("payout_not_authorised")).toBe("approve_failed");
    expect(approveFailureNotice(undefined)).toBe("approve_failed");
  });
  it("a viewer is admin unless it is exactly ops", () => {
    expect(asViewer("ops")).toBe("ops");
    expect(asViewer("../x")).toBe("admin");
  });
  it("a period needs two ISO dates in order", () => {
    expect(periodSchema.safeParse({ start: "2026-09-28", end: "2026-10-04" }).success).toBe(true);
    expect(periodSchema.safeParse({ start: "2026-10-04", end: "2026-09-28" }).success).toBe(false);
    expect(periodSchema.safeParse({ start: "28/09/2026", end: "2026-10-04" }).success).toBe(false);
  });
  it("a payout row with an unknown state is refused rather than shown", () => {
    const row = {
      id: "11111111-1111-4111-8111-111111111111", clinician_id: "22222222-2222-4222-8222-222222222222", clinician_name: "A", period_start: "2026-09-28",
      period_end: "2026-10-04", amount_kobo: 4000, line_count: 2, state: "draft", fee_schedule_versions: [1], prepared_by: "33333333-3333-4333-8333-333333333333",
      prepared_by_name: "B", prepared_at: "2026-10-05T00:00:00Z", approved_by_name: null, approved_at: null, approval_note: null, cancel_reason: null, can_approve: true,
    };
    expect(payoutRowSchema.safeParse(row).success).toBe(true);
    expect(payoutRowSchema.safeParse({ ...row, state: "paid" }).success).toBe(false);
  });
});
