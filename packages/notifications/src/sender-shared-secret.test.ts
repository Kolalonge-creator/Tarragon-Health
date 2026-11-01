/**
 * The notification sender is driven only by the database (pg_cron and four trigger/sweep functions), which sends the vault secret in
 * x-sender-secret. The handler must check it before it reads a single pending row, and the check must live in the database so there
 * is no environment copy to fall out of step. Behaviour of the guard itself is covered by sender-auth.test.ts (Deno); the database
 * side by packages/db/tests/notification_sender_shared_secret.sql.
 */
import "./support/deno.ts";
import { describe, expect, it } from "@jest/globals";
import { readFileSync } from "node:fs";

const read = (p: string) => readFileSync(new URL(`../../../${p}`, import.meta.url), "utf8");
const sender = read("supabase/functions/send-pending-notifications/index.ts");
const config = read("supabase/config.toml");

describe("send-pending-notifications refuses callers without the shared secret", () => {
  it("checks the secret through the database before reading any pending notification", () => {
    expect(sender).toContain("refuseUnlessSender(req");
    expect(sender).toContain('"verify_notification_sender_secret"');
    expect(sender.indexOf("refuseUnlessSender(req")).toBeLessThan(sender.indexOf('.from("notifications")'));
    expect(sender).toContain("Deno.serve(withSentry(\"send-pending-notifications\", async (req: Request) =>");
  });
  it("does not read the secret from the function environment", () => {
    expect(sender).not.toMatch(/Deno\.env\.get\(["']NOTIFICATION_SENDER_SECRET/);
  });
  it("keeps verify_jwt off: the bearer is a publishable key, the secret header is the real check", () => {
    expect(config).toMatch(/\[functions\.send-pending-notifications\]\s*\nverify_jwt = false/);
  });
});
