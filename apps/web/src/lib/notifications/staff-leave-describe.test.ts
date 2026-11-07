import { describe as suite, expect, it } from "@jest/globals";
import { describe } from "./describe-in-app";

const at = { id: "n1", created_at: "2026-11-07T08:00:00Z", read_at: null };
const out = (template: string, payload: Record<string, unknown>) =>
  describe({ ...at, template, payload } as Parameters<typeof describe>[0]);

suite("staff leave notifications (HR Phase C)", () => {
  it("tells an approver a request is waiting, with no name, dates or leave type", () => {
    const n = out("staff_leave_requested", { request_id: "6f1c2b3a-1111-4222-8333-944455556666" });
    expect(n).toEqual({ text: "A leave request is waiting for your decision", href: "/account/leave" });
  });

  it("tells the person the outcome only", () => {
    expect(out("staff_leave_decided", { decision: "approved" }).text).toBe("Your leave request was approved");
    expect(out("staff_leave_decided", { decision: "rejected" }).text).toBe("Your leave request was not approved");
    expect(out("staff_leave_decided", {}).text).toBe("Your leave request was decided");
    expect(out("staff_leave_decided", { decision: "approved" }).href).toBe("/account/leave");
  });
});
