/**
 * S04b-3 repo scan: every push, email and web-push send goes through send-pending-notifications, the one place that
 * applies quiet hours, discreet mode and the INV-07 re-lint. This fails if a new file talks to a delivery provider
 * directly. SMS (Termii) is a separate, codes-and-paging-only route (INV-08) and is allow-listed file by file, with
 * the reason, so a new SMS sender also has to be added here on purpose.
 */
import { describe, expect, it } from "@jest/globals";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, resolve } from "node:path";

const ROOT = resolve(process.cwd(), "../..");
const SKIP_DIRS = new Set(["node_modules", ".next", ".git", "dist", "build", "coverage", ".expo", "ios", "android", "migrations"]);

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    if (SKIP_DIRS.has(name)) continue;
    const full = join(dir, name);
    const st = statSync(full);
    if (st.isDirectory()) walk(full, out);
    else if (/\.(ts|tsx|mjs|js)$/.test(name) && !/\.(test|spec)\.[tj]sx?$/.test(name) && !name.endsWith(".d.ts")) out.push(full);
  }
  return out;
}

const files = ["supabase/functions", "apps", "packages", "services"]
  .map((d) => join(ROOT, d))
  .filter((d) => { try { return statSync(d).isDirectory(); } catch { return false; } })
  .flatMap((d) => walk(d))
  .map((f) => ({ path: relative(ROOT, f), text: readFileSync(f, "utf8") }));

const PIPELINE = "supabase/functions/send-pending-notifications/index.ts";

interface Rule { readonly name: string; readonly pattern: RegExp; readonly allowed: ReadonlyMap<string, string> }

const rules: Rule[] = [
  {
    name: "Expo push send",
    pattern: /exp\.host\/--\/api\/v2\/push\/send/,
    allowed: new Map([[PIPELINE, "the pipeline"]]),
  },
  {
    name: "web push send",
    pattern: /\bwebpush\.sendNotification\(|from ["']web-push["']|npm:web-push/,
    allowed: new Map([[PIPELINE, "the pipeline"]]),
  },
  {
    name: "Resend email send",
    pattern: /api\.resend\.com\/emails|createResendEmail\(|emailFromEnv\(/,
    allowed: new Map([
      [PIPELINE, "the pipeline"],
      ["supabase/functions/_shared/integrations/email-resend.ts", "S14 adapter; not called by any production code (asserted below)"],
      ["supabase/functions/_shared/integrations/from-env.ts", "S14 adapter factory; not called by any production code (asserted below)"],
    ]),
  },
  {
    name: "Termii SMS or voice (SMS stays codes, clinician paging and one invite; INV-08)",
    pattern: /api\.ng\.termii\.com|TERMII_API_KEY/,
    allowed: new Map([
      [PIPELINE, "the pipeline (clinician paging; routine SMS is refused by decide())"],
      ["supabase/functions/auth-send-sms-hook/" + "provider.ts", "verification codes only"],
      ["supabase/functions/abnormal-result-handler/index.ts", "clinician paging fallback (D-12)"],
      ["supabase/functions/paystack-webhook/handler.ts", "one invite SMS to a person with no profile row yet; cannot use the queue"],
      ["apps/web/src/lib/status/check-dependencies.ts", "status page: checks the key is configured, sends nothing"],
      ["apps/web/src/lib/notifications/send-patient-link.ts", "a Zoom join link by SMS from a server action"],
    ]),
  },
];

describe("notification senders", () => {
  it("scans a believable number of files", () => {
    expect(files.length).toBeGreaterThan(500);
    expect(files.some((f) => f.path === PIPELINE)).toBe(true);
  });

  for (const rule of rules) {
    it(`${rule.name}: only the allow-listed files send`, () => {
      const hits = files.filter((f) => rule.pattern.test(f.text)).map((f) => f.path);
      const unexpected = hits.filter((p) => !rule.allowed.has(p));
      expect(unexpected).toEqual([]);
      // The allow-list may not rot: every entry must still match, or it is removed.
      const stale = [...rule.allowed.keys()].filter((p) => !hits.includes(p));
      expect(stale).toEqual([]);
    });
  }

  it("no production code calls the Resend adapter (email goes through the pipeline)", () => {
    const callers = files
      .filter((f) => /emailFromEnv\(|createResendEmail\(|selectProvider\(/.test(f.text) && /email/i.test(f.text))
      .map((f) => f.path)
      .filter((p) => !p.startsWith("supabase/functions/_shared/integrations/") && !p.startsWith("packages/integrations/"));
    const emailCallers = callers.filter((p) => /emailFromEnv\(|createResendEmail\(/.test(files.find((f) => f.path === p)!.text));
    expect(emailCallers).toEqual([]);
  });

  it("the pipeline applies discreet mode and quiet hours before any provider call", () => {
    const text = files.find((f) => f.path === PIPELINE)!.text;
    const decideAt = text.indexOf("decide({");
    for (const call of ["sendEmail(toEmail", "sendWebPush(", "sendExpoPush(", "sendTermiiSms(toPhone"]) {
      const at = text.lastIndexOf(call);
      expect(at).toBeGreaterThan(decideAt);
    }
    // a held or suppressed row leaves the loop before the first provider call
    expect(text.indexOf('decision.action === "defer"')).toBeLessThan(text.indexOf("sendEmail(toEmail"));
    expect(text.indexOf('decision.action === "suppress"')).toBeLessThan(text.indexOf("sendEmail(toEmail"));
    expect(text).toContain("discreetEmail(");
    expect(text).toContain("pushEnvelope(");
    expect(text).toContain("safetyCritical: isSafetyCritical(");
  });
});
