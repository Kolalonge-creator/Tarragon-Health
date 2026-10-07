import { describe, expect, it } from "@jest/globals";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, resolve } from "node:path";

/**
 * S56 scan: no analytics or advertising SDK is imported, directly or through a local import, by any mental-health screen on web or
 * mobile (the BetterHelp precedent: sensitive wellbeing data must never reach an ad or analytics platform). Error reporting through
 * Sentry is allowed, with no session replay (checked below), because it carries no screen content.
 */
const REPO = resolve(process.cwd(), "..", "..");
const WEB = join(REPO, "apps", "web", "src");
const MOBILE = join(REPO, "apps", "mobile", "src");

const BANNED_IMPORT = /(analytics|segment|mixpanel|amplitude|posthog|heap|hotjar|fullstory|logrocket|clarity|appsflyer|adjust|branch|singular|kochava|facebook|fbsdk|google-tag|gtag|gtm|googletagmanager|firebase\/analytics|expo-ads|admob|applovin|onesignal|intercom|hubspot|clevertap|moengage|braze|pendo|smartlook)/i;
const BANNED_CALL = /\b(gtag|fbq|ttq|dataLayer|analytics\.(track|identify|page)|posthog\.capture|mixpanel\.track|amplitude\.track|logEvent)\s*[(.[]/;

const WEB_ENTRY = [
  "components/mental-health",
  "components/mental-health-summary.tsx",
  "app/(dashboard)/patient/(sections)/wellbeing/page.tsx",
  "app/(dashboard)/patient/mental-health-form.tsx",
  "app/(dashboard)/patient/mental-health-actions.ts",
  "app/(dashboard)/patient/wellbeing-checkin-form.tsx",
  "app/(dashboard)/patient/wellbeing-actions.ts",
  "app/(dashboard)/patient/wellbeing-tiles.tsx",
  "app/(dashboard)/patient/wellbeing-trend-chart.tsx",
  "app/(dashboard)/patient/mood-beside-readings.tsx",
  "lib/mental-health",
  "lib/queries/mental-health.ts",
  "lib/queries/wellbeing.ts",
  "lib/queries/mood-trend.ts",
];
const MOBILE_ENTRY = ["screens/sections/wellbeing-screen.tsx", "screens/sections/wellbeing-trend-chart.tsx", "components/mental-health", "lib/mental-health.ts", "lib/wellbeing.ts", "lib/shared-phone.ts"];

function filesUnder(p: string): string[] {
  if (!existsSync(p)) return [];
  if (statSync(p).isFile()) return [p];
  return readdirSync(p).flatMap((n) => filesUnder(join(p, n))).filter((f) => /\.(ts|tsx)$/.test(f) && !/\.test\./.test(f));
}

function importsOf(src: string): string[] {
  return [...src.matchAll(/(?:import|export)\s[^'"]*?from\s*['"]([^'"]+)['"]|import\(\s*['"]([^'"]+)['"]\s*\)|require\(\s*['"]([^'"]+)['"]\s*\)|import\s*['"]([^'"]+)['"]/g)].map((m) => (m[1] ?? m[2] ?? m[3] ?? m[4]) as string);
}

function resolveLocal(spec: string, from: string, root: string): string | null {
  const base = spec.startsWith("@/") ? join(root, spec.slice(2)) : spec.startsWith(".") ? resolve(dirname(from), spec) : null;
  if (!base) return null;
  for (const c of [base, `${base}.ts`, `${base}.tsx`, join(base, "index.ts"), join(base, "index.tsx")]) if (existsSync(c) && statSync(c).isFile()) return c;
  return null;
}

function scan(entries: string[], root: string) {
  const seen = new Set<string>();
  const problems: string[] = [];
  const queue = entries.flatMap((e) => filesUnder(join(root, e)));
  while (queue.length) {
    const f = queue.pop() as string;
    if (seen.has(f)) continue;
    seen.add(f);
    const src = readFileSync(f, "utf8");
    for (const spec of importsOf(src)) {
      if (BANNED_IMPORT.test(spec) && !spec.startsWith("@tarragon/")) problems.push(`${f}: imports ${spec}`);
      const local = resolveLocal(spec, f, root);
      if (local) queue.push(local);
    }
    if (BANNED_CALL.test(src)) problems.push(`${f}: calls a tracking function`);
  }
  return { problems, count: seen.size };
}

describe("no analytics or ad SDK on mental-health screens", () => {
  it("web: nothing reachable from the wellbeing screens imports one", () => {
    const { problems, count } = scan(WEB_ENTRY, WEB);
    expect(count).toBeGreaterThan(15);
    expect(problems).toEqual([]);
  });
  it("mobile: nothing reachable from the wellbeing screens imports one", () => {
    const { problems, count } = scan(MOBILE_ENTRY, MOBILE);
    expect(count).toBeGreaterThan(3);
    expect(problems).toEqual([]);
  });
  it("the scan would catch one (control)", () => {
    expect(BANNED_IMPORT.test("@segment/analytics-next")).toBe(true);
    expect(BANNED_IMPORT.test("react-native-fbsdk-next")).toBe(true);
    expect(BANNED_IMPORT.test("@tanstack/react-query")).toBe(false);
    expect(BANNED_CALL.test("posthog.capture('x')")).toBe(true);
  });
  it("error reporting has no session replay", () => {
    const hits: string[] = [];
    for (const f of filesUnder(WEB)) if (/replayIntegration|replaysSessionSampleRate/.test(readFileSync(f, "utf8"))) hits.push(f);
    expect(hits).toEqual([]);
  });
});
