import { describe, expect, it } from "@jest/globals";
import { daysBefore, leaveAttention, leaveDates, type AdminLeave } from "./leave";

const TODAY = "2026-11-07";

function req(over: Partial<AdminLeave> = {}): AdminLeave {
  return {
    request_id: "00000000-0000-4000-8000-0000000000a1",
    profile_id: "00000000-0000-4000-8000-000000000001",
    full_name: "Ada Obi",
    leave_type: "annual",
    starts_on: "2026-12-01",
    ends_on: "2026-12-05",
    working_days: 5,
    status: "pending",
    requested_at: "2026-11-06T09:00:00Z",
    decided_by_name: null,
    decided_at: null,
    is_clinician: false,
    has_sickness_reason: false,
    ...over,
  };
}

describe("leaveAttention", () => {
  it("leaves a fresh request for far-off leave alone", () => {
    expect(leaveAttention([req()], TODAY)).toEqual([]);
  });

  it("raises a request nobody has decided for three days", () => {
    const [item] = leaveAttention([req({ requested_at: "2026-11-03T09:00:00Z" })], TODAY);
    expect([item?.kind, item?.priority, item?.issue]).toEqual(["leave_awaiting_decision", "low", "Leave request waiting 4 days"]);
  });

  it("raises the priority as the first day comes near, and says when leave started undecided", () => {
    expect(leaveAttention([req({ starts_on: "2026-11-12" })], TODAY)[0]?.priority).toBe("medium");
    expect(leaveAttention([req({ starts_on: "2026-11-08" })], TODAY)[0]?.priority).toBe("high");
    expect(leaveAttention([req({ starts_on: "2026-11-05", leave_type: "sick" })], TODAY)[0]?.issue).toBe("Leave started without a decision");
  });

  it("ignores decided and cancelled requests", () => {
    expect(leaveAttention([req({ status: "approved", starts_on: "2026-11-08" }), req({ status: "cancelled", starts_on: "2026-11-08" })], TODAY)).toEqual([]);
  });
});

describe("leaveDates", () => {
  const fmt = (d: string) => d.slice(5);
  it("shows one day or a range", () => {
    expect(leaveDates("2026-12-01", "2026-12-01", fmt)).toBe("12-01");
    expect(leaveDates("2026-12-01", "2026-12-05", fmt)).toBe("12-01 to 12-05");
  });
});

describe("daysBefore", () => {
  it("steps back whole days across a month boundary", () => {
    expect(daysBefore("2026-11-07", 30)).toBe("2026-10-08");
    expect(daysBefore("2026-03-01", 1)).toBe("2026-02-28");
  });
});
