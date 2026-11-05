import { loadSecurityOverview } from "./security-overview";
import { isDormant } from "./staff-access-review";

const overview = {
  generated_at: "2026-11-05T12:00:00Z",
  failed_sign_ins: { last_24h: 2, last_7d: 9, accounts_7d: 3 },
  sign_ins_7d: 40,
  open_security_alerts: [{ rule: "failed_sign_in_spike", severity: "sev2", first_seen_at: "2026-11-05T11:00:00Z", detail: { failures: 12 } }],
  staff: { total: 7, active: 7, mfa_enrolled: 0, dormant: 2, dormant_after_days: 90 },
  privileged_changes_30d: [{ at: "2026-11-01T10:00:00Z", change: "Account role changed", by: "Ada" }],
  exports_30d: [],
  staff_access_review: { last_completed_at: null, next_due_at: "2026-11-05T12:00:00Z", overdue: true, open_review_id: null, interval_days: 90 },
};
const client = (data: unknown, error: { message: string } | null = null) => ({ rpc: async () => ({ data, error }) });

describe("loadSecurityOverview", () => {
  it("reads the database summary", async () => {
    const r = await loadSecurityOverview(client(overview));
    expect(r.ok && r.value.staff.dormant).toBe(2);
  });
  it("shows a refusal as an error, never as an empty dashboard", async () => {
    expect(await loadSecurityOverview(client(null, { message: "Only an admin can see the security overview." }))).toEqual({
      ok: false,
      message: "The security overview could not be loaded.",
    });
  });
  it("refuses a shape it does not understand", async () => {
    expect((await loadSecurityOverview(client({ ...overview, staff: {} }))).ok).toBe(false);
  });
});

describe("isDormant", () => {
  const now = new Date("2026-11-05T00:00:00Z");
  it("counts a missing sign-in as dormant", () => expect(isDormant(null, 90, now)).toBe(true));
  it("uses the configured line", () => {
    expect(isDormant("2026-08-01T00:00:00Z", 90, now)).toBe(true);
    expect(isDormant("2026-10-01T00:00:00Z", 90, now)).toBe(false);
  });
});
