/**
 * Spec D.3 / INV: "No advertising or marketing SDKs; product analytics on de-identified events only." (audit 1.13)
 *
 * The rule has been true by habit. This makes it true by test, because an ad or tracking SDK in a health app is itself the liability:
 * the Flo case ended in a regulator order and a court finding against the company whose SDK collected the data, not only against the app.
 *
 * Three scans, none of which can pass vacuously:
 *   1. no dependency in any package.json is on the deny-list (advertising, attribution, marketing automation, behavioural analytics,
 *      session replay, social pixels);
 *   2. no source file loads a third-party tracking host (a tag manager, a pixel, a heat map script);
 *   3. the web content-security policy does not allow any of those hosts, so a tag added later would be blocked at the browser too.
 *
 * Allowed on purpose: Sentry (error monitoring; events are scrubbed by apps/web/src/lib/sentry/scrub-pii.ts). Adding anything else
 * that watches people needs a decision recorded in docs/DECISIONS.md and an entry in ALLOWED_WITH_DECISION below.
 */
import { describe, expect, it } from "@jest/globals";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("../../..", import.meta.url));

/** Package name patterns for advertising, attribution, marketing automation, behavioural analytics, session replay and social pixels. */
const DENIED_PACKAGES: RegExp[] = [
  /(^|\/)firebase$/, // the web SDK bundles analytics; the mobile app does not use Firebase
  /firebase[-/]analytics/,
  /@react-native-firebase\/(analytics|admob|app-distribution|perf)/,
  /fbsdk|facebook-sdk|react-native-fbsdk|facebook-nodejs-business-sdk|react-facebook-pixel/,
  /@segment\/|analytics-react-native|analytics-next|analytics-node/,
  /mixpanel/,
  /amplitude/,
  /appsflyer/,
  /(^|\/)(react-native-)?adjust(-sdk)?$/,
  /branch-sdk|react-native-branch/,
  /posthog/,
  /heap-|@heap\//,
  /hotjar|clarity|logrocket|fullstory|smartlook|mouseflow/,
  /google-mobile-ads|expo-ads|admob|react-native-ads/,
  /react-ga|react-gtm|gtag|ga4|google-analytics|vercel\/analytics|@vercel\/speed-insights/,
  /onesignal|braze|clevertap|customerio|moengage|leanplum|airship/,
  /tiktok|snapchat|linkedin-insight|twitter-pixel/,
];

/** Tracking hosts a page or app must never load. */
const DENIED_HOSTS =
  /googletagmanager\.com|google-analytics\.com|doubleclick\.net|connect\.facebook\.net|facebook\.com\/tr|analytics\.tiktok|static\.hotjar|clarity\.ms|cdn\.segment|cdn\.mxpnl|api\.mixpanel|posthog\.com|js\.hs-scripts|snap\.licdn|ads-twitter|appsflyer\.com|app\.adjust|branch\.io\/v|onesignal\.com\/sdks/;

/** Something that watches people, allowed only with a recorded decision. Empty on purpose: Sentry is error monitoring, not on this list. */
const ALLOWED_WITH_DECISION: Record<string, string> = {};

const SKIP = new Set(["node_modules", ".next", ".git", "dist", "build", ".turbo", "coverage", ".expo", "ios", "android", ".vercel"]);

function walk(dir: string, accept: (name: string) => boolean, out: string[]): void {
  let names: string[];
  try {
    names = readdirSync(dir);
  } catch {
    return;
  }
  for (const name of names) {
    if (SKIP.has(name)) continue;
    const full = join(dir, name);
    if (statSync(full).isDirectory()) walk(full, accept, out);
    else if (accept(name)) out.push(full);
  }
}

function manifests(): string[] {
  const out: string[] = [];
  for (const top of ["apps", "packages", "services", "tools", "scripts"]) walk(join(ROOT, top), (n) => n === "package.json", out);
  out.push(join(ROOT, "package.json"));
  return out;
}

function dependencyNames(file: string): string[] {
  const json = JSON.parse(readFileSync(file, "utf8")) as Record<string, Record<string, string> | undefined>;
  return ["dependencies", "devDependencies", "optionalDependencies", "peerDependencies"].flatMap((k) => Object.keys(json[k] ?? {}));
}

describe("no advertising or tracking SDKs (D.3, audit 1.13)", () => {
  it("looks at the manifests at all (a broken walker must not pass vacuously)", () => {
    const m = manifests();
    expect(m.length).toBeGreaterThanOrEqual(8);
    expect(m.flatMap(dependencyNames).length).toBeGreaterThan(100);
  });

  it("no dependency in any package.json is an advertising, attribution, marketing or behavioural analytics SDK", () => {
    const hits: string[] = [];
    for (const file of manifests()) {
      for (const dep of dependencyNames(file)) {
        if (dep in ALLOWED_WITH_DECISION) continue;
        if (DENIED_PACKAGES.some((re) => re.test(dep))) hits.push(`${relative(ROOT, file)}: ${dep}`);
      }
    }
    expect(hits).toEqual([]);
  });

  it("the Python ML service depends on no advertising or tracking library either (pyproject.toml and the locked set in uv.lock)", () => {
    const pyproject = readFileSync(join(ROOT, "services/ml/pyproject.toml"), "utf8");
    const lock = readFileSync(join(ROOT, "services/ml/uv.lock"), "utf8");
    expect(pyproject).toMatch(/dependencies\s*=\s*\[/);
    const declared = [...pyproject.matchAll(/^\s*"([A-Za-z0-9_.-]+)/gm)].map((m) => m[1].toLowerCase());
    const locked = [...lock.matchAll(/^name = "([A-Za-z0-9_.-]+)"/gm)].map((m) => m[1].toLowerCase());
    expect(declared.length).toBeGreaterThan(5);
    expect(locked.length).toBeGreaterThan(20);
    const deniedPy = /posthog|mixpanel|amplitude|segment|analytics-python|google-analytics|facebook|appsflyer|adjust|braze|onesignal|hotjar|heap|ads-python/;
    expect([...declared, ...locked].filter((n) => deniedPy.test(n))).toEqual([]);
    // Sentry is the one allowed monitoring dependency; it must be the only "watching" library declared.
    expect(declared).toContain("sentry-sdk");
  });

  it("no source file or public asset loads a third-party tracking host", () => {
    const files: string[] = [];
    const accept = (n: string) => /\.(tsx?|jsx?|mjs|html|json)$/.test(n) && !/\.(test|spec)\./.test(n) && n !== "package.json" && n !== "pnpm-lock.yaml";
    for (const top of ["apps/web/src", "apps/web/public", "apps/mobile/src", "apps/mobile/app.json", "apps/web/next.config.ts", "apps/web/vercel.json"]) {
      const full = join(ROOT, top);
      try {
        if (statSync(full).isDirectory()) walk(full, accept, files);
        else files.push(full);
      } catch {
        /* a path that does not exist cannot load anything */
      }
    }
    expect(files.length).toBeGreaterThan(200);
    const hits = files.filter((f) => DENIED_HOSTS.test(readFileSync(f, "utf8"))).map((f) => relative(ROOT, f));
    expect(hits).toEqual([]);
  });

  it("the web content-security policy names none of those hosts, so a tag added later would be blocked in the browser too", () => {
    const csp = readFileSync(join(ROOT, "apps/web/next.config.ts"), "utf8");
    expect(csp).toMatch(/connect-src/);
    expect(DENIED_HOSTS.test(csp)).toBe(false);
  });

  it("the mobile config plugin list adds no tracking plugin", () => {
    const app = JSON.parse(readFileSync(join(ROOT, "apps/mobile/app.json"), "utf8")) as { expo: { plugins?: Array<string | [string, unknown]> } };
    const names = (app.expo.plugins ?? []).map((p) => (Array.isArray(p) ? p[0] : p));
    expect(names.length).toBeGreaterThan(5);
    expect(names.filter((n) => DENIED_PACKAGES.some((re) => re.test(n)))).toEqual([]);
  });

  it("SABOTAGE: the deny-lists do catch the shapes that mattered", () => {
    for (const bad of ["firebase", "@react-native-firebase/analytics", "react-native-fbsdk-next", "mixpanel-react-native", "@amplitude/analytics-react-native", "react-native-appsflyer", "@segment/analytics-react-native", "posthog-react-native", "react-native-google-mobile-ads", "@vercel/analytics", "react-native-onesignal"]) {
      expect(DENIED_PACKAGES.some((re) => re.test(bad))).toBe(true);
    }
    for (const fine of ["@sentry/nextjs", "expo-notifications", "react", "next", "@supabase/supabase-js", "zod"]) {
      expect(DENIED_PACKAGES.some((re) => re.test(fine))).toBe(false);
    }
    expect(DENIED_HOSTS.test('<script src="https://www.googletagmanager.com/gtag/js?id=G-1"></script>')).toBe(true);
    expect(DENIED_HOSTS.test("https://connect.facebook.net/en_US/fbevents.js")).toBe(true);
    expect(DENIED_HOSTS.test("https://abc.supabase.co/rest/v1/")).toBe(false);
  });
});
