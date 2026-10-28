/**
 * S80 gap closure: the partner "please confirm your listing" email is neutral (INV-07: no patient, reading, result or money) and names only the
 * listing and the last check date.
 */
import "./support/deno.ts";
import { describe, expect, it } from "@jest/globals";
import { describeViolations, lintText } from "./index.ts";
import { TEMPLATE_MAP } from "../../../supabase/functions/send-pending-notifications/templates.ts";

type Render = (payload: Record<string, unknown>, ctx: never) => { smsText: string; email?: { subject: string; html: string; text?: string } };
const render = (TEMPLATE_MAP as unknown as Record<string, Render>)["directory_partner_recheck_notice"];

describe("directory_partner_recheck_notice", () => {
  it("has an email rendering", () => {
    expect(render).toBeDefined();
    const out = render!({ listing_name: "Yaba Lab", last_checked: "2025-01-02", to_email: "x@example.invalid" }, undefined as never);
    expect(out.email?.subject).toMatch(/confirm/i);
    expect(out.email?.text).toContain("2025-01-02");
  });

  it("passes the neutral-wording lint and does not echo unrelated payload fields", () => {
    const out = render!({ listing_name: "Yaba Lab", last_checked: "not yet", patient_name: "Ada Obi", result: "HbA1c 9", amount_kobo: 5000 }, undefined as never);
    for (const text of [out.smsText, out.email?.subject ?? "", out.email?.text ?? ""]) {
      expect(describeViolations(lintText(text))).toEqual([]);
      expect(text).not.toMatch(/Ada|Obi|HbA1c|5000/);
    }
  });

  it("does not echo the listing name and escapes the date field", () => {
    const out = render!({ listing_name: "Yaba Lab", last_checked: "<script>x</script>" }, undefined as never);
    expect(out.email?.html).not.toContain("<script>");
    expect(out.email?.text).not.toContain("Yaba");
  });
});
