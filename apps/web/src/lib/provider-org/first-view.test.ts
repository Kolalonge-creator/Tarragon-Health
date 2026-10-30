import { providerOrgFirstView } from "./first-view";
import { providerOverview } from "./overview-summary";

const analytics = (byStatus: Record<string, number>) => ({
  staff_by_role: { owner: 1 },
  structure: { locations: 2, departments: 1, services: 1, resources: 1 },
  referrals_by_status: byStatus,
  referral_avg_response_hours: 2,
});
const ready = (byStatus: Record<string, number>) =>
  providerOverview({ data: analytics(byStatus), error: null });

describe("providerOrgFirstView", () => {
  it("leads with paid referrals waiting to be booked, then the waitlist", () => {
    const v = providerOrgFirstView(ready({ payment_confirmed: 2, waitlisted: 4, booked: 9 }), "org-1");
    if (v.kind !== "items") throw new Error("expected items");
    expect(v.top.text).toBe("2 referrals are paid and waiting to be booked");
    expect(v.rest.map((i) => i.text)).toEqual(["4 referrals are on the waitlist"]);
  });

  it("uses singular wording and keeps the organisation on the link", () => {
    const v = providerOrgFirstView(ready({ waitlisted: 1 }), "a b");
    if (v.kind !== "items") throw new Error("expected items");
    expect(v.top.text).toBe("1 referral is on the waitlist");
    expect(v.top.href).toBe("/provider-org/referrals?org=a%20b");
  });

  it("ignores finished and already-booked statuses", () => {
    expect(providerOrgFirstView(ready({ booked: 3, confirmed: 1, completed: 8, closed: 2, pending_payment: 4 }), "o")).toEqual({
      kind: "clear",
    });
  });

  it("is clear when nothing is routed here at all", () => {
    expect(providerOrgFirstView(ready({}), "o")).toEqual({ kind: "clear" });
  });

  it("is unknown, never clear, when the figures did not load", () => {
    expect(providerOrgFirstView(providerOverview({ data: null, error: { message: "boom" } }), "o")).toEqual({
      kind: "unknown",
    });
    expect(providerOrgFirstView(providerOverview({ data: { nonsense: true }, error: null }), "o")).toEqual({
      kind: "unknown",
    });
  });
});
