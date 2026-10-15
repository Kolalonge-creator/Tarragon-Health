import { testingDayErrorText, seatsLabel } from "./testing-days";

jest.mock("./supabase", () => ({ supabase: { rpc: jest.fn() } }));

describe("testing days (mobile)", () => {
  it("turns a database code into a sentence and never shows an unknown message raw", () => {
    expect(testingDayErrorText("membership_required")).toBe("Testing days are part of Membership.");
    expect(testingDayErrorText("new_day_full_keep_current")).toMatch(/kept your current place/);
    expect(testingDayErrorText('permission denied for table "testing_events"')).toBe("Something went wrong. Please try again.");
    expect(testingDayErrorText(undefined)).toBe("Something went wrong. Please try again.");
  });

  it("labels the places left, and a full day offers the waiting list", () => {
    expect(seatsLabel({ seats_left: 1, full: false })).toBe("1 place left");
    expect(seatsLabel({ seats_left: 7, full: false })).toBe("7 places left");
    expect(seatsLabel({ seats_left: 0, full: true })).toMatch(/waiting list/);
  });

  it("no error sentence names a test, a result or a condition", () => {
    const all = ["membership_required", "testing_day_not_available", "already_booked_use_reschedule", "booking_not_found"].map(testingDayErrorText).join(" ");
    expect(all).not.toMatch(/hiv|hepatitis|blood|ecg|urine|glucose|result|positive|diabet/i);
  });
});
