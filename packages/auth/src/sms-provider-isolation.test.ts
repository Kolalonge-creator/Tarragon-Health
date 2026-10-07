/**
 * INV-08: SMS is used only for phone verification codes. "Only the auth SMS hook calls the SMS provider."
 *
 * Two checks, both on the real source tree:
 *  1. Nothing imports the hook's provider module except the hook itself.
 *  2. A RATCHET over every file that talks to Termii directly. Those legacy senders (clinician paging, reminders,
 *     join links, emergency-contact SMS) are decided by OQ-05 / OQ-30 / OQ-32 and removed in their own session; the
 *     list below may only SHRINK. A new direct Termii caller fails this test, which is the point.
 *
 * Also pins the hook's copy of the OTP limits to the versioned config (a Deno function cannot import the package).
 */
import { describe, expect, it } from "@jest/globals";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { getProposedConfig } from "@tarragon/shared";

const ROOT = join(process.cwd(), "..", "..");
const SKIP = new Set(["node_modules", ".next", ".turbo", "dist", ".git", ".expo", "coverage", "worktrees"]);

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    if (SKIP.has(name)) continue;
    const full = join(dir, name);
    const st = statSync(full);
    if (st.isDirectory()) walk(full, out);
    else if (/\.(ts|tsx|mts|js|mjs)$/.test(name)) out.push(full);
  }
  return out;
}

const files = ["apps", "packages", "supabase/functions"].flatMap((d) => walk(join(ROOT, d)));
const rel = (f: string) => relative(ROOT, f).split(sep).join("/");
const HOOK_DIR = "supabase/functions/auth-send-sms-hook/";

describe("INV-08: the SMS provider is reachable only through the auth hook", () => {
  it("nothing outside the hook imports the hook's provider module", () => {
    const offenders = files
      .filter((f) => !rel(f).startsWith(HOOK_DIR))
      .filter((f) => /auth-send-sms-hook\/provider/.test(readFileSync(f, "utf8")))
      // This test file names the path in a comment and a regex; it is not an importer.
      .filter((f) => !rel(f).endsWith("sms-provider-isolation.test.ts"))
      .map(rel);
    expect(offenders).toEqual([]);
  });

  it("inside the hook, only handler.ts and index.ts (and tests) touch provider.ts", () => {
    const importers = files
      .filter((f) => rel(f).startsWith(HOOK_DIR))
      .filter((f) => /from "\.\/provider\.ts"/.test(readFileSync(f, "utf8")))
      .map((f) => rel(f).slice(HOOK_DIR.length))
      .sort();
    expect(importers).toEqual(["handler.test.ts", "handler.ts", "index.ts", "provider.test.ts"]);
  });

  // Legacy direct Termii callers (non-test source). Decided in OQ-05/OQ-30/OQ-32; this list may only shrink.
  const LEGACY_DIRECT_TERMII = [
    "apps/web/src/lib/notifications/send-patient-link.ts", // patient join-link SMS (OQ-32)
    "apps/web/src/lib/status/check-dependencies.ts", // reads the key to report "configured", sends nothing
    "supabase/functions/send-pending-notifications/index.ts", // push-failure fallback and templates (OQ-32)
  ];

  it("no NEW file calls Termii directly (ratchet: the legacy list may only shrink)", () => {
    const direct = files
      .filter((f) => !rel(f).startsWith(HOOK_DIR))
      .filter((f) => !/\.test\.(ts|tsx)$/.test(f) && !/e2e/.test(rel(f)))
      .filter((f) => /api\.ng\.termii\.com|TERMII_API_KEY/.test(readFileSync(f, "utf8")))
      .map(rel)
      .sort();
    const unexpected = direct.filter((f) => !LEGACY_DIRECT_TERMII.includes(f));
    expect(unexpected).toEqual([]);
    // A legacy entry that no longer talks to Termii must be removed from the list, or the ratchet stops ratcheting.
    const stale = LEGACY_DIRECT_TERMII.filter((f) => !direct.includes(f));
    expect(stale).toEqual([]);
  });
});

describe("hook limits match the versioned config", () => {
  it("MAX_SENDS_PER_HOUR in the hook equals auth.phone_otp.maxSendsPerHour", () => {
    const cfg = getProposedConfig("auth.phone_otp").value as { maxSendsPerHour: number };
    const src = readFileSync(join(ROOT, HOOK_DIR, "handler.ts"), "utf8");
    const m = /export const MAX_SENDS_PER_HOUR = (\d+)/.exec(src);
    expect(m).not.toBeNull();
    expect(Number(m![1])).toBe(cfg.maxSendsPerHour);
  });
});
