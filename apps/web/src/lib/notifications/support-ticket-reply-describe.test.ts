import { describe, expect, it } from "@jest/globals";
import { describe as describeInApp } from "./describe-in-app";

/** SUP-2: a staff reply on a technical ticket tells the patient only that support replied, with a link to the ticket. */
describe("support_ticket_reply", () => {
  it("names no reply text and links to the ticket", () => {
    const out = describeInApp({ template: "support_ticket_reply", payload: { ticket_id: "abc", body: "Your BP medicine is fine" } });
    expect(out.text).toBe("Your support team replied");
    expect(out.href).toBe("/patient/support/abc");
    expect(out.text).not.toMatch(/BP|medicine/);
  });
  it("falls back to the support page without an id", () => {
    expect(describeInApp({ template: "support_ticket_reply", payload: {} }).href).toBe("/patient/support");
  });
});
