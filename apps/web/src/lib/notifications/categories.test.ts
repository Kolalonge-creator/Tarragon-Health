import { categoryFor } from "./categories";
import { describe as describeNotification } from "./describe-in-app";

describe("categoryFor", () => {
  it.each([
    ["/patient/appointments", "appointments"],
    ["/patient/consultation/abc", "appointments"],
    ["/patient/labs", "results"],
    ["/patient/medications", "medicines"],
    ["/patient/membership", "payments"],
    ["/patient/settings/security", "account"],
    ["/patient/care#after-visit-summary", "care"],
    ["/patient", "care"],
  ])("groups %s as %s", (href, expected) => {
    expect(categoryFor(null, href)).toBe(expected);
  });

  it("does not match a longer path that only shares a prefix", () => {
    expect(categoryFor(null, "/patient/labsx")).toBe("care");
  });

  it("picks out money templates that link to a general page", () => {
    expect(categoryFor("care_voucher_expiring", "/patient")).toBe("payments");
  });

  it("groups the real appointment notices from describe-in-app", () => {
    const { href } = describeNotification({ template: "appointment_cancelled", payload: {} });
    expect(categoryFor("appointment_cancelled", href)).toBe("appointments");
  });
});
