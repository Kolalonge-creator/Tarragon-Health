import { describe, expect, it } from "@jest/globals";
import {
  describeMembershipError,
  endMembershipSchema,
  endOfDayLagos,
  grantMembershipSchema,
  membershipRowsSchema,
} from "./members";

const id = "11111111-1111-4111-8111-111111111111";

describe("grantMembershipSchema", () => {
  it("accepts a reason of 10 characters with no end date", () => {
    const r = grantMembershipSchema.safeParse({ base: "/admin/members", patientId: id, reason: "Staff trial run" });
    expect(r.success).toBe(true);
  });
  it("refuses a short reason", () => {
    const r = grantMembershipSchema.safeParse({ base: "/admin/members", patientId: id, reason: "short" });
    expect(r.success).toBe(false);
  });
  it("refuses a base path that is not one of the two pages", () => {
    const r = grantMembershipSchema.safeParse({ base: "/evil", patientId: id, reason: "Staff trial run" });
    expect(r.success).toBe(false);
  });
  it("refuses a badly formed end date", () => {
    const r = grantMembershipSchema.safeParse({ base: "/clinician/members", patientId: id, endsOn: "tomorrow", reason: "Staff trial run" });
    expect(r.success).toBe(false);
  });
});

describe("endMembershipSchema", () => {
  it("needs a reason of 10 or more characters", () => {
    expect(endMembershipSchema.safeParse({ base: "/admin/members", patientId: id, reason: "nine char" }).success).toBe(false);
    expect(endMembershipSchema.safeParse({ base: "/admin/members", patientId: id, reason: "Left the programme" }).success).toBe(true);
  });
});

describe("endOfDayLagos", () => {
  it("is 23:59:59 in Lagos, one hour ahead of UTC", () => {
    expect(endOfDayLagos("2027-01-31")).toBe("2027-01-31T22:59:59.000Z");
  });
});

describe("describeMembershipError", () => {
  it.each([
    ["membership_not_authorised", /do not have access/],
    ["membership_reason_needed", /reason/],
    ["membership_end_in_past", /future/],
    ["membership_already_active", /already has an active/],
    ["membership_none_active", /no active membership/],
  ])("maps %s to plain words", (code, pattern) => {
    expect(describeMembershipError({ message: code })).toMatch(pattern);
  });
  it("never shows raw database text", () => {
    expect(describeMembershipError({ message: "relation x does not exist" })).toBe("Something went wrong. Please try again.");
  });
});

describe("membershipRowsSchema", () => {
  it("parses the list_memberships shape and carries no amount", () => {
    const rows = membershipRowsSchema.parse([
      { patient_id: id, full_name: "A B", patient_number: "TH-1", membership_id: null, source: null, starts_at: null, ends_at: null, grant_reason: null, is_member: false },
    ]);
    expect(Object.keys(rows[0] as object).some((k) => /price|amount|kobo|naira/.test(k))).toBe(false);
  });
});
