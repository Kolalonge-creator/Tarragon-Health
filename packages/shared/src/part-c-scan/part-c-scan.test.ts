import { describe, expect, it } from "@jest/globals";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { PART_C_ALLOWLIST } from "./allowlist";
import { PART_C_RULES, scanPackageJson, scanRepo, scanText } from "./scan";

const repoRoot = join(fileURLToPath(new URL(".", import.meta.url)), "../../../..");
const today = () => new Date().toISOString().slice(0, 10);
const key = (rule: string, file: string) => `${rule}|${file}`;

describe("Part C conformance scan (S87)", () => {
  const violations = scanRepo(repoRoot);
  const allowed = new Set(PART_C_ALLOWLIST.map((a) => key(a.rule, a.file)));

  it("finds no banned feature outside the allowlist", () => {
    const fresh = violations.filter((v) => !allowed.has(key(v.rule, v.file)));
    expect(fresh.map((v) => `${v.rule} ${v.file}:${v.line} ${v.text}`)).toEqual([]);
  });

  it("has no stale allowlist entry (the conflict was fixed, so remove the entry)", () => {
    const seen = new Set(violations.map((v) => key(v.rule, v.file)));
    const stale = PART_C_ALLOWLIST.filter((a) => !seen.has(key(a.rule, a.file)));
    expect(stale.map((a) => `${a.rule} ${a.file}`)).toEqual([]);
  });

  it("has no expired allowlist entry (decide it, then fix or renew with a new decision)", () => {
    const expired = PART_C_ALLOWLIST.filter((a) => a.expires < today());
    expect(expired.map((a) => `${a.rule} ${a.file} expired ${a.expires} (${a.oq})`)).toEqual([]);
  });

  it("ties every entry to a real, written open question", () => {
    const oq = readFileSync(join(repoRoot, "docs/OPEN-QUESTIONS.md"), "utf8");
    for (const a of PART_C_ALLOWLIST) {
      expect(a.oq).toMatch(/^OQ-\d+$/);
      expect(oq).toContain(`### ${a.oq} `);
      expect(a.reason.length).toBeGreaterThan(10);
    }
  });

  it("covers every rule with at least one test case below", () => {
    expect(PART_C_RULES.map((r) => r.id).sort()).toEqual(
      ["auto-renew", "contraception-claim", "fasting-timer", "fertile-window-label", "patient-sms", "public-social", "removed-name", "stored-balance", "whatsapp"].sort(),
    );
  });
});

describe("scan rules discriminate (sabotage)", () => {
  const ids = (content: string, file = "x.tsx") => scanText(file, content).map((v) => v.rule);

  it("flags each banned thing", () => {
    expect(ids('const c = "send via WhatsApp";')).toContain("whatsapp");
    expect(ids("await topUpHealthWallet();")).toContain("stored-balance");
    expect(ids("await ok(); // wallet_topup is only a comment")).toEqual([]);
    expect(ids('kind: "health_wallet_topup"')).toContain("stored-balance");
    expect(ids('copy: "Your plan will auto-renew monthly"')).toContain("auto-renew");
    expect(ids("const fastingTimer = 1;")).toContain("fasting-timer");
    expect(ids('title: "Intermittent fasting timer"')).toContain("fasting-timer");
    expect(ids('label: "Leaderboard"')).toContain("public-social");
    expect(ids('name: "Helemed"')).toContain("removed-name");
    expect(ids('copy: "Know your safe days"')).toContain("contraception-claim");
    expect(ids('await send({ channel: "sms", template: "x" })')).toContain("patient-sms");
    expect(ids('const t = "Fertile window 3 to 8 May";')).toContain("fertile-window-label");
  });

  it("lets the permitted wording through", () => {
    expect(ids('copy: "Nothing auto-renews."')).toEqual([]);
    expect(ids('copy: "One-off payment, no auto-renewal."')).toEqual([]);
    expect(ids('copy: "Not contraception. This cannot prevent pregnancy." // Fertile window 3 to 8 May')).toEqual([]);
    expect(ids('const t = "Fertile window 3 to 8 May"; const l = "Not contraception";')).toEqual([]);
    expect(ids('type Channel = "sms" | "email";')).toEqual([]);
    expect(ids('await auth.verifyOtp({ phone, token, type: "sms" })')).toEqual([]);
  });

  it("flags an ad SDK dependency but not the current ones", () => {
    const bad = JSON.stringify({ dependencies: { "react-native-google-mobile-ads": "1.0.0" } });
    expect(scanPackageJson("apps/mobile/package.json", bad).map((v) => v.rule)).toEqual(["ad-sdk"]);
    const good = JSON.stringify({ dependencies: { "@sentry/nextjs": "1.0.0" } });
    expect(scanPackageJson("apps/web/package.json", good)).toEqual([]);
  });
});
