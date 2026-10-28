import { describe, expect, it } from "@jest/globals";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  AI_REGISTRY_FILE,
  AI_SURFACES,
  AI_SYSTEM_SURFACES,
  RENDERS_AI_LABEL,
  findAiCallSites,
  findAiRenderingCandidates,
  registeredAiSystemCodes,
  scanAiCallSites,
  scanAiRenderingCandidates,
  scanAiSystemMap,
} from "./ai-surfaces";
import { PART_C_RULES, analyticsAliases, balancedCallText, everyMatchGoverned, isTrackerPackage, scanAiSurface, scanAnalyticsCalls, scanPackageJson, scanText, verifiedLabelRenderers } from "./scan";

/**
 * Review fixes to the S87 extension scan (2026-10-27): each rule is tested on the strings that used to slip through (a negation
 * anywhere on the line, a tracker substring, a 400 character window) and on the strings that must still pass.
 */
const repoRoot = join(fileURLToPath(new URL(".", import.meta.url)), "../../../..");
const MKT = "apps/web/src/app/(marketing)/page.tsx";
const ids = (content: string, file = MKT) => scanText(file, content).map((v) => v.rule);

describe("claims, trial and auto-renew: only a negation that governs the phrase exempts it", () => {
  it("a negation elsewhere on the line no longer lets a claim through", () => {
    expect(ids('copy: "Cures diabetes, not just manages it"')).toContain("marketing-claim");
    expect(ids('copy: "Guaranteed results, no waiting"')).toContain("marketing-claim");
    expect(ids('copy: "Not only does it cure diabetes"')).toContain("marketing-claim");
    expect(ids('copy: "No fees and it cures diabetes"')).toContain("marketing-claim");
    expect(ids('copy: "Never wait. It cures diabetes"')).toContain("marketing-claim");
    expect(ids('copy: "No cure for others, but ours cures diabetes"')).toContain("marketing-claim");
    expect(ids('copy: "Not a myth, it cures diabetes"')).toContain("marketing-claim");
    expect(ids('copy: "Free healthcare, no questions asked"')).toContain("marketing-claim");
    expect(ids('copy: "FDA approved, nothing to worry about"')).toContain("marketing-claim");
    expect(ids('copy: "Start your free trial, no card needed"')).toContain("trial-copy");
    expect(ids('copy: "then you will be charged, not a big amount"')).toContain("trial-copy");
    expect(ids('copy: "Your plan will auto-renew monthly, no fuss"')).toContain("auto-renew");
  });

  it("a negation or debunking frame directly governing the phrase still passes", () => {
    expect(ids('copy: "Diabetes has no cure, only control"')).toEqual([]);
    expect(ids('copy: "This is not a cure"')).toEqual([]);
    expect(ids('copy: "We cannot cure it, and nothing does"')).toEqual([]);
    expect(ids('copy: "We can\'t cure it"')).toEqual([]);
    expect(ids('copy: "We never guarantee results"')).toEqual([]);
    expect(ids('copy: "We do not claim to cure anything"')).toEqual([]);
    expect(ids('copy: "No miracle cures"')).toEqual([]);
    expect(ids('copy: "Sold as cures that aren\'t real"')).toEqual([]);
    expect(ids('copy: "Herbs widely marketed in Nigeria as diabetes cures"')).toEqual([]);
    expect(ids('copy: "Myth: this tea cures diabetes. Fact: it does not."')).toEqual([]);
    expect(ids('copy: "No free trial, no surprise charge"')).toEqual([]);
    expect(ids('copy: "We don\'t offer a free trial"')).toEqual([]);
    expect(ids('copy: "One-off payment, no auto-renewal."')).toEqual([]);
    expect(ids('copy: "Nothing auto-renews."')).toEqual([]);
    expect(ids('copy: "Turn off auto-renew any time"')).toEqual([]);
    expect(ids('copy: "Auto-renew is off"')).toEqual([]);
  });

  it("copy wrapped across two lines keeps its negation, and one ungoverned match among several still fails", () => {
    expect(ids('const a = "no jargon, no fear, no\n miracle cures";')).toEqual([]);
    expect(ids('copy: "No cure here, but this one cures diabetes"')).toContain("marketing-claim");
  });

  it("everyMatchGoverned is false with no match and when any match is ungoverned (control)", () => {
    const rule = PART_C_RULES.find((r) => r.id === "marketing-claim")!;
    expect(everyMatchGoverned("nothing here", rule.pattern!, rule.exemptNear!)).toBe(false);
    expect(everyMatchGoverned("no cure", rule.pattern!, rule.exemptNear!)).toBe(true);
    expect(everyMatchGoverned("no cure, cures", rule.pattern!, rule.exemptNear!)).toBe(false);
  });
});

describe("tracker-sdk: package-name tokens, not substrings", () => {
  const rules = (dep: string) => scanPackageJson("p/package.json", JSON.stringify({ dependencies: { [dep]: "1.0.0" } })).map((v) => v.rule);

  it("flags the real trackers", () => {
    for (const dep of [
      "posthog-react-native", "posthog-js", "@segment/analytics-react-native", "mixpanel-browser", "@mixpanel/browser", "@amplitude/analytics-browser",
      "amplitude-js", "@vercel/analytics", "@react-native-firebase/analytics", "react-ga4", "react-gtm-module", "@hotjar/browser", "react-hotjar",
      "@microsoft/clarity", "@fullstory/browser", "logrocket", "react-facebook-pixel", "react-native-onesignal", "react-native-branch",
      "react-native-adjust", "@braze/web-sdk", "@datadog/browser-rum", "plausible-tracker", "@statsig/js-client", "launchdarkly-js-client-sdk",
      "@next/third-parties", "heap-analytics", "expo-firebase-analytics",
    ]) {
      expect(isTrackerPackage(dep)).toBe(true);
      expect(rules(dep)).toEqual(["tracker-sdk"]);
    }
  });

  it("does not flag packages that merely contain a tracker-like substring", () => {
    for (const dep of [
      "@react-native-segmented-control/segmented-control", "segment-tree", "react-native-pixel-ratio", "pixel-ratio-helper", "heap-js", "branch-name",
      "adjust-color", "clarity-ui", "facebook-login-button", "react-native-fbsdk-login-helper-no", "gtag-types-not-real", "tiktok-ui-kit", "snapchat-filters-ui",
      "@sentry/nextjs", "next", "react-native-reanimated", "date-fns",
    ]) {
      expect(isTrackerPackage(dep)).toBe(false);
    }
    expect(rules("@react-native-segmented-control/segmented-control")).toEqual([]);
  });

  it("a brand token is a whole token (control: the same brand inside a longer word is clean)", () => {
    expect(isTrackerPackage("posthog-thing")).toBe(true);
    expect(isTrackerPackage("posthogger")).toBe(false);
  });
});

describe("paystack-recurring: no file is exempt by path", () => {
  it("index.ts and test-fake-supabase.ts are scanned like any other file; only handler.ts is allowlisted by OQ", () => {
    for (const f of ["index.ts", "test-fake-supabase.ts", "order-branch.ts"]) {
      expect(ids('case "subscription.create": {', `supabase/functions/paystack-webhook/${f}`)).toContain("paystack-recurring");
    }
    const rule = PART_C_RULES.find((r) => r.id === "paystack-recurring")!;
    expect(rule.exemptFiles).toBeUndefined();
  });
});

describe("analytics-health-field: balanced parentheses and aliases", () => {
  it("reads the whole call, however long, and nothing after it", () => {
    const pad = Array.from({ length: 40 }, (_, i) => `field_${i}: ${i},`).join(" "); // well past 400 characters
    expect(pad.length).toBeGreaterThan(400);
    expect(scanAnalyticsCalls("a.ts", `track("evt", { ${pad} reading: 150 });`).length).toBe(1);
    expect(scanAnalyticsCalls("a.ts", `track("screen_view")\nconst row = { reading: 1, bp: 2 };`)).toEqual([]);
    expect(scanAnalyticsCalls("a.ts", `track("a", { x: fn(1) }, "b"); const other = { condition: "x" };`)).toEqual([]);
    expect(scanAnalyticsCalls("a.ts", `track("a", { x: fn(1), reading: 2 });`).length).toBe(1);
    expect(scanAnalyticsCalls("a.ts", `track("a", { note: ");", reading: 2 });`).length).toBe(1);
    expect(balancedCallText("f(a(b), 'c)')", 1)).toBe("(a(b), 'c)')");
  });

  it("follows an import alias, a re-assigned function, a destructured one and a client import", () => {
    expect(analyticsAliases('import { track as t, other } from "./a";').fns).toEqual(["t"]);
    expect(scanAnalyticsCalls("a.ts", 'import { track as t } from "./analytics";\nt("x", { reading: 150 });').length).toBe(1);
    expect(scanAnalyticsCalls("a.ts", 'const send = analytics.track;\nsend("x", { glucose: 9 });').length).toBe(1);
    expect(scanAnalyticsCalls("a.ts", 'const { track: t } = analytics;\nt("x", { condition: "d" });').length).toBe(1);
    expect(scanAnalyticsCalls("a.ts", 'import ph from "posthog-js";\nph.capture("x", { bp: 1 });').length).toBe(1);
    expect(scanAnalyticsCalls("a.ts", 'import * as mp from "mixpanel-browser";\nmp.track("x", { medication: "m" });').length).toBe(1);
    // controls: an alias with a clean payload, and an unrelated alias, are not flagged
    expect(scanAnalyticsCalls("a.ts", 'import { track as t } from "./a";\nt("x", { screen: "home" });')).toEqual([]);
    expect(scanAnalyticsCalls("a.ts", 'import { format as f } from "./a";\nf("x", { reading: 1 });')).toEqual([]);
  });
});

describe("ai-label: the label may live in a shared component", () => {
  it("a surface passes when it renders AiLabel or a verified label renderer, and fails when it does neither", () => {
    expect(scanAiSurface("s.tsx", "<AiDraftBlock text={t} />")).toHaveLength(1);
    expect(scanAiSurface("s.tsx", "<AiDraftBlock text={t} />", ["AiDraftBlock"])).toEqual([]);
    expect(scanAiSurface("s.tsx", "<AiDraftBlockX />", ["AiDraftBlock"])).toHaveLength(1);
    expect(scanAiSurface("s.tsx", "<AiLabel />")).toEqual([]);
  });

  it("a renderer name counts only when its defining file exists and renders AiLabel; absent is skipped", () => {
    const withLabel = new Map([["apps/web/src/components/ai/ai-draft-block.tsx", 'export function AiDraftBlock() { return <AiLabel variant="drafted" />; }']]);
    const noLabel = new Map([["apps/web/src/components/ai/ai-draft-block.tsx", "export function AiDraftBlock() { return <p>text</p>; }"]]);
    expect(verifiedLabelRenderers(withLabel, ["AiDraftBlock"])).toEqual({ names: ["AiDraftBlock"], violations: [] });
    expect(verifiedLabelRenderers(new Map(), ["AiDraftBlock"])).toEqual({ names: [], violations: [] });
    const bad = verifiedLabelRenderers(noLabel, ["AiDraftBlock"]);
    expect(bad.names).toEqual([]);
    expect(bad.violations.map((v) => v.text)).toEqual(["AiDraftBlock is listed in RENDERS_AI_LABEL but does not render AiLabel"]);
    expect(RENDERS_AI_LABEL).toContain("AiDraftBlock");
  });
});

describe("ai-label: the surface list follows the registered AI systems and the call sites", () => {
  const registry = [
    "export const AI_SYSTEMS = {",
    "  coach: {",
    '    code: "AI-001",',
    "  },",
    "  newThing: {",
    '    code: "AI-099",',
    "  },",
    "} as const;",
  ].join("\n");

  it("a registered system with no entry fails, and so does a stale entry", () => {
    expect(registeredAiSystemCodes(registry)).toEqual(["AI-001", "AI-099"]);
    const map = { "AI-001": { surfaces: ["a.tsx"] }, "AI-050": { noText: "no longer registered at all, a stale entry" } } as const;
    const texts = scanAiSystemMap(registry, map).map((v) => v.text);
    expect(texts.some((t) => t.startsWith("AI-099 is registered but has no entry"))).toBe(true);
    expect(texts.some((t) => t.startsWith("AI-050 is in AI_SYSTEM_SURFACES but is not a registered AI system"))).toBe(true);
    expect(scanAiSystemMap(registry, { "AI-001": { surfaces: ["a.tsx"] }, "AI-099": { noText: "a structured score, nothing is shown to a person" } })).toEqual([]);
    // an empty surface list or a throwaway reason is not an answer
    expect(scanAiSystemMap(registry, { "AI-001": { surfaces: [] }, "AI-099": { noText: "n/a" } })).toHaveLength(2);
  });

  it("the real registry is fully mapped, every surface is derived from the map, and the checked list includes the draft reply card", () => {
    const real = readFileSync(join(repoRoot, AI_REGISTRY_FILE), "utf8");
    const codes = registeredAiSystemCodes(real);
    expect(codes.length).toBeGreaterThanOrEqual(20);
    for (const c of codes) expect(AI_SYSTEM_SURFACES[c]).toBeDefined();
    expect(scanAiSystemMap(real)).toEqual([]);
    expect(AI_SURFACES).toContain("apps/web/src/components/draft-reply-card.tsx");
    expect(AI_SURFACES).toContain("apps/web/src/app/(dashboard)/patient/meal-plan-section.tsx");
  });

  const files = new Map<string, string>([
    ["apps/web/src/lib/thing/generate.ts", 'import { AI_SYSTEMS, runGovernedAi } from "@/lib/ai-governance";\nawait runGovernedAi({ systemCode: AI_SYSTEMS.coach.code });'],
    ["apps/web/src/lib/thing/actions.ts", 'import { generate } from "./generate";\nexport async function go() { return generate(); }'],
    ["apps/web/src/app/(dashboard)/patient/thing-card.tsx", 'import { go } from "@/lib/thing/actions";\nexport function ThingCard() { return null; }'],
    ["apps/web/src/app/(dashboard)/patient/other.tsx", 'import { x } from "./unrelated";\nexport function Other() { return null; }'],
    ["apps/web/src/app/(dashboard)/patient/unrelated.ts", "export const x = 1;"],
    ["apps/web/src/lib/ai-governance/run-governed.ts", "export async function runGovernedAi() {}"],
    ["apps/web/src/lib/thing/commented.ts", "// runGovernedAi is described here only\nexport const y = 1;"],
    ["apps/web/src/app/api/thing/route.ts", 'import { AI_SYSTEMS, runGovernedAi } from "@/lib/ai-governance";\nrunGovernedAi({ systemCode: AI_SYSTEMS.coach.code });'],
    ["apps/mobile/src/screens/thing-screen.tsx", 'await fetch(`${base}/api/thing`);\nexport function ThingScreen() { return null; }'],
  ]);

  it("finds call sites (not tests, not the governance module, not comments) and requires each to name a registered system", () => {
    expect(findAiCallSites(files)).toEqual(["apps/web/src/app/api/thing/route.ts", "apps/web/src/lib/thing/generate.ts"]);
    expect(scanAiCallSites(files, registry)).toEqual([]);
    const anon = new Map(files).set("apps/web/src/lib/thing/generate.ts", 'import { runGovernedAi } from "@/lib/ai-governance";\nawait runGovernedAi({ systemCode: "AI-001" });');
    expect(scanAiCallSites(anon, registry).map((v) => v.text)).toEqual(["calls runGovernedAi without naming a registered system (AI_SYSTEMS.<key>)"]);
    const unknown = new Map(files).set("apps/web/src/lib/thing/generate.ts", "runGovernedAi({ systemCode: AI_SYSTEMS.ghost.code });");
    expect(scanAiCallSites(unknown, registry)[0].text).toMatch(/AI_SYSTEMS\.ghost.*not in the registry/);
  });

  it("finds the components that sit on a call site (through an action file, or by fetching its route) and demands a decision for each", () => {
    expect(findAiRenderingCandidates(files)).toEqual([
      "apps/mobile/src/screens/thing-screen.tsx",
      "apps/web/src/app/(dashboard)/patient/thing-card.tsx",
    ]);
    const undecided = scanAiRenderingCandidates(files, [], {});
    expect(undecided.map((v) => v.file)).toEqual(["apps/mobile/src/screens/thing-screen.tsx", "apps/web/src/app/(dashboard)/patient/thing-card.tsx"]);
    // decided: one is a surface, one has a written reason
    expect(
      scanAiRenderingCandidates(files, ["apps/web/src/app/(dashboard)/patient/thing-card.tsx"], {
        "apps/mobile/src/screens/thing-screen.tsx": "Shows a structured number the person confirms; no model prose.",
      }),
    ).toEqual([]);
    // stale, throwaway and contradictory entries fail
    const bad = scanAiRenderingCandidates(files, ["apps/web/src/app/(dashboard)/patient/thing-card.tsx"], {
      "apps/mobile/src/screens/thing-screen.tsx": "short",
      "apps/web/src/app/(dashboard)/patient/other.tsx": "Not a candidate any more, so this entry is stale.",
      "apps/web/src/app/(dashboard)/patient/thing-card.tsx": "Listed as a surface and also reviewed, which is contradictory.",
    });
    expect(bad.map((v) => v.text).sort()).toEqual([
      "AI_SURFACE_REVIEWED entry is no longer a candidate (stale): remove it",
      "AI_SURFACE_REVIEWED needs a real reason",
      "is both a surface and a reviewed non-surface: pick one",
    ]);
  });
});
