import { describe as jestDescribe, expect, it } from "@jest/globals";
import { describe } from "./notification-bell";
import type { InAppNotification } from "@/lib/queries/notifications";

function notification(overrides: Partial<InAppNotification>): InAppNotification {
  return {
    id: "n1",
    status: "pending",
    template: null,
    payload: {},
    created_at: new Date().toISOString(),
    priority: "routine",
    response_options: null,
    responded_at: null,
    response_value: null,
    ...overrides,
  };
}

jestDescribe("describe() — security templates", () => {
  it("points security.new_device_signin at the real /account page", () => {
    // Regression: this used to link to /patient/settings/security, a route
    // that has never existed — found 2026-09-18 while adding the
    // security.account_locked case below.
    const result = describe(notification({ template: "security.new_device_signin" }));
    expect(result.href).toBe("/account");
  });

  it("has a real describe() case for security.account_locked", () => {
    // Regression: this template (added by
    // 20260918111442_account_lockout_after_repeated_failed_logins.sql) had
    // no case here at all, so it fell through to the generic fallback —
    // exactly the "misleading in_app dashboard" bug class this file's own
    // header comment warns against.
    const result = describe(notification({ template: "security.account_locked" }));
    expect(result.text).not.toBe("You have an update");
    expect(result.href).toBe("/account");
  });
});
