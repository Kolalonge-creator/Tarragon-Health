/**
 * S04b-3 repo scan: every push, email and web-push send goes through send-pending-notifications, the one place that
 * applies quiet hours, discreet mode and the INV-07 re-lint. This fails if a new file talks to a delivery provider
 * directly. SMS (Termii) is a separate, verification-codes-only route (INV-08; OQ-727, founder decision 2026-10-27: no page
 * to a clinician goes by SMS or voice) and is allow-listed file by file, with the reason, so a new SMS sender also has to be
 * added here on purpose.
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
/**
 * Front Desk M2: follow-up email to people who have no profile (an enquirer from the website) cannot go through the pipeline, whose recipients are
 * profiles. This sender is allow-listed on purpose, and it carries the same protections itself, which the test below pins: quiet hours, the
 * frequency cap, consent and suppression are decided in SQL (service_fd_claim_runs) before anything is sent, and the Resend adapter re-lints
 * every `patient` audience email for conditions, readings, results and medicines (INV-07). Discreet mode concerns clinical notification content,
 * which these emails never carry.
 */
const FRONT_DESK_DISPATCHER = "supabase/functions/fd-followup-dispatcher/index.ts";

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
      [FRONT_DESK_DISPATCHER, "Front Desk follow-up email to non-patients; gates are in SQL and the adapter lint (asserted below)"],
    ]),
  },
  {
    name: "Termii SMS or voice (SMS is verification codes only; INV-08, OQ-727)",
    pattern: /api\.ng\.termii\.com|TERMII_API_KEY/,
    allowed: new Map([
      ["supabase/functions/auth-send-sms-hook/" + "provider.ts", "verification codes only"],
      ["apps/web/src/lib/status/check-dependencies.ts", "status page: checks the key is configured, sends nothing"],
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
    expect(emailCallers).toEqual([FRONT_DESK_DISPATCHER]);
  });

  it("the Front Desk dispatcher sends only what the database claimed, under the patient lint, with one-click unsubscribe", () => {
    const entry = files.find((f) => f.path === FRONT_DESK_DISPATCHER)!.text;
    const dispatch = files.find((f) => f.path === "supabase/functions/_shared/frontdesk/dispatch.ts")!.text;
    const handler = files.find((f) => f.path === "supabase/functions/fd-followup-dispatcher/handler.ts")!.text;
    // the only source of recipients is the claim function, which applies consent, suppression, quiet hours, caps and dry-run
    expect(entry).toContain("service_fd_claim_runs");
    expect(dispatch).not.toMatch(/\.from\(["']fd_contacts/);
    // every send is audience "patient" (INV-07 lint in the adapter), idempotent per run, and carries List-Unsubscribe headers
    expect(dispatch).toContain('audience: "patient"');
    expect(dispatch).toContain("fd-run-");
    expect(dispatch).toContain("headers: mail.headers");
    // fails closed: no secret, wrong secret, or no email provider means nothing is claimed
    expect(handler.indexOf("x-fd-followup-secret")).toBeLessThan(handler.indexOf("dispatchFollowups("));
    expect(handler).toContain("deps.email");
  });

  it("the pipeline applies discreet mode and quiet hours before any provider call", () => {
    const text = files.find((f) => f.path === PIPELINE)!.text;
    const decideAt = text.indexOf("decide({");
    for (const call of ["sendEmail(toEmail", "sendWebPush(", "sendExpoPush("]) {
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

  it("OQ-727: the pipeline and the abnormal-result handler carry no SMS or voice sender, and refuse sms and voice rows first", () => {
    const pipeline = files.find((f) => f.path === PIPELINE)!.text;
    const handler = files.find((f) => f.path === "supabase/functions/abnormal-result-handler/index.ts")!.text;
    for (const text of [pipeline, handler]) {
      expect(text).not.toMatch(/termii|sendTermii\w*\(|sendClinicianPageSms\(/i);
    }
    // every sms or voice row is refused (critical: failed so the ladder moves; routine: suppressed) before any template or provider work
    const gate = pipeline.indexOf('if (row.channel === "sms" || row.channel === "voice") {');
    expect(gate).toBeGreaterThan(0);
    expect(gate).toBeLessThan(pipeline.indexOf("TEMPLATE_MAP[row.template]", gate));
    expect(gate).toBeLessThan(pipeline.indexOf("sendEmail(toEmail", gate));
    expect(pipeline).toContain("refusedSmsOutcome(row.priority)");
    // the last branch no longer sends anything: it fails the row visibly
    expect(pipeline).toContain("cannot be sent through this queue");
    // a helper that was removed in S85-D3 but still called crashed every batch: nothing here may call an undefined helper
    expect(pipeline).not.toContain("platformDisabledChannel");
  });

  it("OQ-727: a clinician page that cannot be queued opens a sev1 ops incident for the ops desk instead of ending in an audit row", () => {
    const page = readFileSync(join(ROOT, "supabase/functions/abnormal-result-handler/clinician-page.ts"), "utf8");
    expect(page).toContain('"page_nobody_reachable:abnormal_result:"');
    expect(page).toContain("raiseIncident(");
    expect(page).toContain("incidentFailed");
    const handler = files.find((f) => f.path === "supabase/functions/abnormal-result-handler/index.ts")!.text;
    expect(handler).toContain("pageClinicians(");
    expect(handler).toContain("status: pageOutcome.incidentFailed ? 500 : 200");
  });
});
