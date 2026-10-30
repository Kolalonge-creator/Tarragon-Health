import { providerOverview } from "./overview-summary";

const base = {
  staff_by_role: { owner: 1, nurse: 4 },
  structure: { locations: 2, departments: 3, services: 5, resources: 6 },
  referrals_by_status: {} as Record<string, number>,
  referral_avg_response_hours: 0,
};
const reply = (over: Partial<typeof base>) => ({ data: { ...base, ...over }, error: null });

describe("providerOverview", () => {
  it("sums staff across roles", () => {
    const o = providerOverview(reply({}));
    expect(o.kind === "ready" && o.staff).toBe(5);
  });

  it("counts only referrals still open as 'open referrals'", () => {
    const o = providerOverview(
      reply({
        referrals_by_status: { payment_confirmed: 2, pending: 1, waitlisted: 1, booked: 3, confirmed: 1, completed: 10, closed: 4, declined: 2, pending_payment: 5, draft: 1 },
      }),
    );
    expect(o.kind === "ready" && o.openReferrals).toBe(8);
  });

  it("shows no response time until a referral has been booked, since the database reports 0 for nothing to average", () => {
    const none = providerOverview(reply({ referrals_by_status: { pending: 3, declined: 1 }, referral_avg_response_hours: 0 }));
    expect(none.kind === "ready" && none.avgResponseHours).toBeNull();
    const some = providerOverview(reply({ referrals_by_status: { booked: 1 }, referral_avg_response_hours: 6.5 }));
    expect(some.kind === "ready" && some.avgResponseHours).toBe(6.5);
  });

  it("is failed when the read errored or the reply is not the shape we expect", () => {
    expect(providerOverview({ data: null, error: { message: "boom" } })).toEqual({ kind: "failed" });
    expect(providerOverview({ data: null, error: null })).toEqual({ kind: "failed" });
    expect(providerOverview({ data: { staff_by_role: {} }, error: null })).toEqual({ kind: "failed" });
  });
});
