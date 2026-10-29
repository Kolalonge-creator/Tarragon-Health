import { describe, expect, it } from "@jest/globals";
import { readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * The unacknowledged-alert ladder (backup, senior, admin) writes push, email and in-app rows, and SMS is refused for
 * notifications (INV-08). A template with no `email` rendering makes send-pending-notifications mark the email row
 * failed with "template has no email rendering", so a clinician or admin with no push subscription is never reached.
 * That happened live (8 failed email rows on clinician_alert_ack_timeout_admin, last 2026-10-19). Every rung's template
 * must therefore render an email.
 */
const src = readFileSync(
  join(__dirname, "../../../../../supabase/functions/send-pending-notifications/templates.ts"),
  "utf8",
);

function templateBlock(name: string): string {
  const start = src.indexOf(`  ${name}: (payload) => {`);
  if (start === -1) throw new Error(`template ${name} not found in templates.ts`);
  const end = src.indexOf("\n  },", start);
  return src.slice(start, end);
}

describe("clinician_alert_ack_timeout_* templates render an email", () => {
  for (const rung of ["backup", "senior", "admin"]) {
    it(`${rung} rung has an email rendering`, () => {
      expect(templateBlock(`clinician_alert_ack_timeout_${rung}`)).toMatch(/\bemail:\s*ackTimeoutEmail\(/);
    });
  }

  it("the shared email escapes the message and names no patient", () => {
    const helper = src.slice(src.indexOf("function ackTimeoutEmail"), src.indexOf("export function renderBroadcastEmailHtml"));
    expect(helper).toContain("escapeHtmlForBroadcast(message)");
    expect(helper).not.toMatch(/patient|title|payload/i);
  });
});
