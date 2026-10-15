/**
 * P5: the three new credential notices (mid-year MDCN re-check due and overdue, registration evidence needed) go through the real
 * credential_notice renderer and the INV-07 lint. They name a person and a date for staff, never a condition, reading or result.
 */
import "./support/deno.ts";
import { describe, expect, it } from "@jest/globals";
import { en } from "@tarragon/i18n";
import { describeViolations, lintRenderFn, lintText } from "./index.ts";
import { TEMPLATE_MAP } from "../../../supabase/functions/send-pending-notifications/templates.ts";
import { CREDENTIAL_MESSAGE_KEYS } from "../../../supabase/functions/_shared/clinical/credential-messages.ts";

const ctx = { notificationId: "n", recipientId: "r" };
const KEYS = ["credential.recheck_due", "credential.recheck_overdue", "credential.primary_source_missing"] as const;

describe("P5 credential notices", () => {
  for (const key of KEYS) {
    it(`${key} has an English subject and body, is registered, and passes the INV-07 lint when rendered`, () => {
      const msg = CREDENTIAL_MESSAGE_KEYS[key];
      expect(msg).toBeDefined();
      const catalogue = en as Record<string, string>;
      expect(catalogue[msg.title]).toBeTruthy();
      expect(catalogue[msg.body]).toBeTruthy();
      expect(describeViolations(lintText(`${catalogue[msg.title]} ${catalogue[msg.body]}`.replace(/\{[a-z]+\}/g, " ")))).toEqual([]);
      const render = TEMPLATE_MAP["credential_notice"];
      expect(render).toBeDefined();
      const violations = describeViolations(
        lintRenderFn((p) => render!({ ...p, i18n_key: key, i18n_params: { name: "A clinician", date: "01 Nov 2026" } }, ctx)),
      );
      expect(violations).toEqual([]);
    });
  }

  it("renders the catalogue text with the person and date filled in, as an in-app and email notice only", () => {
    const out = TEMPLATE_MAP["credential_notice"]!(
      { i18n_key: "credential.recheck_overdue", i18n_params: { name: "A clinician", date: "01 Nov 2026" }, subject: "x", message: "y" },
      ctx,
    );
    expect(out.email?.subject).toBe("MDCN spot re-check overdue");
    expect(out.email?.text).toContain("A clinician: the MDCN spot re-check was due on 01 Nov 2026");
  });

  it("copy has no em dashes and says nothing that must stay clinical", () => {
    for (const key of KEYS) {
      for (const part of ["subject", "body"]) {
        const text = (en as Record<string, string>)[`${key}.${part}`] ?? "";
        expect(text).not.toContain("—");
        expect(text).not.toContain("–");
      }
    }
  });
});
