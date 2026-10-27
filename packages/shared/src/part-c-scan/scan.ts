import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import {
  AI_REGISTRY_FILE,
  AI_SURFACES,
  RENDERS_AI_LABEL,
  scanAiCallSites,
  scanAiRenderingCandidates,
  scanAiSystemMap,
} from "./ai-surfaces";

export { AI_SURFACES } from "./ai-surfaces";

/**
 * Part C conformance scan (v5 spec Part C: "Do not build", S87).
 *
 * Fails the build when code or marketing copy brings back something the spec bans. Known conflicts
 * live in `allowlist.ts`, each with an open-question id and an expiry date, so the list can only
 * shrink. This is a line heuristic over source, not proof of absence: a clean result means "no hits".
 * Live schema is proven separately in `packages/db/tests`.
 */
export interface PartCRule {
  readonly id: string;
  readonly part: string;
  readonly reason: string;
  /** Line pattern, applied to non-comment lines of source files. */
  readonly pattern?: RegExp;
  /** A line matching this is not a violation. Whole-line, so use it only for an explicit phrase, never a bare negation word. */
  readonly unless?: RegExp;
  /**
   * A match is exempt only when a negation or debunking marker governs THAT phrase: `before` is tested against the clause text
   * immediately preceding the match (contractions folded, cut at punctuation), `after` against the text immediately following it.
   * A negation elsewhere on the line ("cures diabetes, not just manages it", "Guaranteed results, no waiting") exempts nothing.
   * A line is a violation when at least one match is ungoverned.
   */
  readonly exemptNear?: NearExemption;
  /** File-level rule: flag a file that matches `whenFile` but never matches `requireFile`. */
  readonly whenFile?: RegExp;
  readonly requireFile?: RegExp;
  /** Only files whose repo-relative path matches are scanned by this rule. */
  readonly files?: RegExp;
  /** Files whose path matches are exempt from this rule (stated, with the reason, next to the rule). */
  readonly exemptFiles?: RegExp;
}

export interface NearExemption {
  readonly before?: RegExp;
  readonly after?: RegExp;
  /** An explicit debunking frame ("Myth: ...", "marketed as cancer cures") earlier in the same sentence, no comma in between. */
  readonly debunkBefore?: RegExp;
}

/** Marketing pages and the copy catalogues (S87 claims scan). */
const MARKETING_COPY = /^apps\/web\/src\/app\/\(marketing\)\/|^packages\/i18n\/src\/(?!.*\.test\.)/;

/**
 * Negation words that count only when they sit directly before the banned phrase (at most two filler words between), as in
 * "no cure", "not a cure", "cannot cure", "never guarantee", "no free trial". Contractions are folded first (can't -> cant).
 */
const NEGATION_WORDS = "no|not|never|cannot|nothing|without|nor|cant|wont|doesnt|dont|isnt|arent|didnt|wouldnt|shouldnt";
const NEGATION_FILLER = "a|an|the|any|real|true|proven|known|miracle|magic|overnight|quick|claim to|claims to|promise to|pretend to|offer|promise|claim";
function governingNegation(extraWords: string[] = []): RegExp {
  return new RegExp(`\\b(?:${[NEGATION_WORDS, ...extraWords].join("|")})\\b(?:\\s+(?:${NEGATION_FILLER})){0,2}\\s*$`, "i");
}
// "Not a myth: it cures" is a claim, not a debunking, so a negated 'myth' does not count.
const DEBUNK_BEFORE = /(?<!\b(?:not|no|never)\s+(?:a\s+)?)\b(?:myths?|marketed(?:\s+\w+){0,3}\s+as|so-called|sold as|advertised as)\b[^,]{0,40}$/i;
/** "cures that aren't real": the negation follows the claim noun directly. */
const NEGATED_AFTER = /^(?:\s+\w+){0,2}\s+(?:that|which)\s+(?:arent|isnt|are not|is not|dont|do not|never)\b/i;
const CLAIM_EXEMPTION: NearExemption = { before: governingNegation(), after: NEGATED_AFTER, debunkBefore: DEBUNK_BEFORE };

const foldContractions = (t: string) => t.replace(/(\w)['\u2019](\w)/g, "$1$2");
/** The clause text just before a match: cut at the last punctuation or quote, so a negation in an earlier clause cannot govern it. */
function clauseBefore(text: string): string {
  const folded = foldContractions(text);
  const cut = Math.max(...[".", ";", ":", "!", "?", ",", "(", ")", '"', "'", "`", "{", "}", "[", "]"].map((c) => folded.lastIndexOf(c)));
  return folded.slice(cut + 1);
}
function sentenceBefore(text: string): string {
  const folded = foldContractions(text);
  const cut = Math.max(...[".", ";", "!", "?", '"', "'", "`"].map((c) => folded.lastIndexOf(c)));
  return folded.slice(cut + 1);
}
/** True when every match of `pattern` in `code` is governed by a negation or debunking frame (see `PartCRule.exemptNear`). */
export function everyMatchGoverned(code: string, pattern: RegExp, near: NearExemption, leading = ""): boolean {
  const global = new RegExp(pattern.source, pattern.flags.includes("g") ? pattern.flags : `${pattern.flags}g`);
  let any = false;
  for (const m of code.matchAll(global)) {
    any = true;
    const at = m.index ?? 0;
    // `leading` is the previous source line, so copy wrapped across two lines ("no\n miracle cures") keeps its negation.
    const before = clauseBefore(`${leading} ${code.slice(0, at)}`);
    const after = foldContractions(code.slice(at + m[0].length));
    const governed =
      (near.before?.test(before) ?? false) ||
      (near.debunkBefore?.test(sentenceBefore(`${leading} ${code.slice(0, at)}`)) ?? false) ||
      (near.after?.test(after) ?? false);
    if (!governed) return false;
  }
  return any;
}

export const PART_C_RULES: readonly PartCRule[] = [
  { id: "whatsapp", part: "C.2", reason: "WhatsApp was removed (F-02)", pattern: /whatsapp/i },
  {
    id: "stored-balance",
    part: "C.2",
    reason: "no stored balance, wallet top-up or platform credit (INV-09)",
    pattern: /health[_ ]?wallet|wallet[_ ]?top[- ]?up|platform[_ ]?credit|stored[_ -]?value|top[_ ]?up balance/i,
  },
  {
    id: "auto-renew",
    part: "C.1",
    reason: "care packs never auto-renew; only a negation may mention it. Membership renewal is allowed by founder decision 2026-10-26, so code identifiers (autoRenew, auto_renew) are not flagged, only prose",
    pattern: /auto[- ]renew/i,
    // Only a negation directly before the phrase ("no auto-renewal", "Nothing auto-renews") or "off" right after it counts.
    exemptNear: { before: governingNegation(["off"]), after: /^(?:s|al|ed|ing)?\s+(?:is\s+|are\s+|stays\s+)?(?:off|disabled)\b/i },
  },
  {
    id: "fasting-timer",
    part: "C.1",
    reason: "no general intermittent-fasting timers",
    pattern: /fasting[_ -]?timer|intermittent[_ -]?fasting|eating[_ -]?window/i,
  },
  {
    id: "public-social",
    part: "C.1",
    reason: "no public feeds, profiles or leaderboards",
    pattern: /leaderboard|public[_ ]?profile|public[_ ]?feed/i,
  },
  { id: "removed-name", part: "C.2", reason: "the name 'Helemed' was dropped", pattern: /helemed/i },
  {
    id: "contraception-claim",
    part: "C.1",
    reason: "no cycle-based contraception claims",
    pattern: /safe days|avoid(ing)? pregnancy|natural contraception|prevent(s|ing)? pregnancy/i,
    unless: /cannot prevent|can't prevent|not contraception|does not prevent/i,
  },
  {
    id: "fertile-window-label",
    part: "C.1",
    reason:
      "any file that shows a fertile window must also carry the words 'Not contraception', or render the one shared label (FERTILE_WINDOW_LABEL / FertileWindowNotice, S85 D2). Whether a screen renders it is proved by the screen tests, not by this scan.",
    whenFile: /fertile window/i,
    // Not an import alone: the label must be rendered (`<FertileWindowNotice`) or used as text (`{FERTILE_WINDOW_LABEL}`).
    requireFile: /not contraception|<FertileWindowNotice|\{FERTILE_WINDOW_LABEL\}/i,
  },
  {
    id: "patient-sms",
    part: "C.2",
    reason:
      "SMS is for verification codes only (sent by Supabase phone auth): no clinician paging, no emergency-contact SMS, no invite or link SMS (OQ-332, OQ-333, D3). Catches Termii sends and sendSms-style helpers as well as channel: \"sms\"",
    pattern:
      /(channel|value):\s*["']sms["']|sendPatientLinkSms\(|\bsend\w*Sms\w*\(|api\.ng\.termii\.com|TERMII_API_[K]EY|\bsendTermii\w*\(/,
    unless: /\|/, // a type union such as `"sms" | "email"` is a declaration, not a send
    // Verification codes are the one permitted use: the auth hook provider. The status page only checks the key exists and sends nothing.
    exemptFiles: /^supabase\/functions\/auth-send-sms-hook\/|^apps\/web\/src\/lib\/status\/check-dependencies\.ts$/,
  },
  {
    id: "tracker-script",
    part: "D.3",
    reason: "no ad, analytics or tracking script, pixel or SDK call anywhere (cookie page promises no trackers). Add to TRACKER_ALLOWLIST only by decision",
    pattern:
      /googletagmanager\.com|google-analytics\.com|connect\.facebook\.net|\bfbq\(|\bgtag\(|static\.hotjar\.com|clarity\.ms|plausible\.io|cdn\.segment\.(com|io)|posthog|mixpanel|amplitude\.com|snap\.licdn\.com|analytics\.tiktok\.com|doubleclick\.net|<Script\b[^>]*\bsrc=|<script\b[^>]*\bsrc=["']https?:/i,
  },
  {
    id: "marketing-claim",
    part: "E",
    reason:
      "marketing and copy must not claim a cure, a guaranteed outcome, FDA or NAFDAC approval (no verified registration constant exists), 'instant doctor' or 'free healthcare'",
    files: MARKETING_COPY,
    pattern:
      /\b(cures?|cured|curing)\b|guarantee[sd]?\s+(results?|outcomes?|cure|recovery|to\b)|(FDA|NAFDAC)[- ]approved|approved by (the )?(FDA|NAFDAC)|instant (doctor|consult)|free (health ?care|medical care|treatment)/i,
    exemptNear: CLAIM_EXEMPTION,
  },
  {
    id: "doctor-led-headline",
    part: "E",
    reason: "'doctor-led' was retired as a headline or marketing claim on 2026-07-18 (CLAUDE.md brand rule); describe the clinical process instead",
    files: MARKETING_COPY,
    pattern: /doctor[- ]led/i,
  },
  {
    id: "testimonial-hardcoded",
    part: "E",
    reason:
      "a testimonial quote typed into marketing code or copy has no consent or disclosure record: testimonials come only from the consent-gated patient_testimonials rows (TestimonialsSection), never from source",
    files: MARKETING_COPY,
    pattern: /\bquote:\s*["'`]/,
  },
  {
    id: "trial-copy",
    part: "C.1",
    reason: "no free trial that turns into a charge: 'free trial' and 'then charged' are banned in prose unless negated",
    files: MARKETING_COPY,
    pattern: /free[- ]trial|then (you.ll be |you will be |we.ll |we will )?charged/i,
    exemptNear: { before: governingNegation(["off"]), after: NEGATED_AFTER },
  },
  {
    id: "paystack-recurring",
    part: "C.1",
    reason:
      "no Paystack plan or subscription creation call: nothing may start recurring billing. The one known dormant webhook handler (handler.ts) is allowlisted with an open question and an expiry; no file is exempt by path (index.ts and test-fake-supabase.ts have no hit, so they need none)",
    pattern: /paystack\.co\/(plan|subscription)\b|\bcreatePaystack(Plan|Subscription)\w*\(|\bcreatePlan\(|\bsubscription\.create\b|"subscription\.create"/,
  },
];

export interface PartCViolation {
  readonly rule: string;
  readonly file: string;
  readonly line: number;
  readonly text: string;
}

const COMMENT_LINE = /^\s*(\/\/|\/\*|\*|\{\s*\/\*)/;
const SKIP_DIRS = new Set([
  "node_modules", ".next", "ios", "android", "dist", "build", ".turbo",
  "e2e", "e2e-browser", "__tests__", "__mocks__", "fixtures", "part-c-scan",
]);
const isSource = (name: string) =>
  /\.(ts|tsx)$/.test(name) && !/\.(test|spec)\.tsx?$/.test(name) && !name.endsWith(".d.ts") && name !== "database.types.ts";

function* walk(dir: string): Generator<string> {
  for (const name of readdirSync(dir)) {
    if (SKIP_DIRS.has(name)) continue;
    const p = join(dir, name);
    if (statSync(p).isDirectory()) yield* walk(p);
    else if (isSource(name)) yield p;
  }
}

export const SOURCE_ROOTS = [
  "apps/web/src",
  "apps/mobile/src",
  "apps/console/src",
  "packages/shared/src",
  "packages/notifications/src",
  "packages/i18n/src",
  "supabase/functions",
] as const;

export function scanText(file: string, content: string): PartCViolation[] {
  const out: PartCViolation[] = [];
  const lines = content.split("\n");
  for (const rule of PART_C_RULES) {
    if (rule.files && !rule.files.test(file)) continue;
    if (rule.exemptFiles && rule.exemptFiles.test(file)) continue;
    if (rule.whenFile && rule.requireFile) {
      if (rule.whenFile.test(content) && !rule.requireFile.test(content)) {
        const idx = lines.findIndex((l) => rule.whenFile!.test(l));
        out.push({ rule: rule.id, file, line: idx + 1, text: (lines[idx] ?? "").trim().slice(0, 160) });
      }
      continue;
    }
    if (!rule.pattern) continue;
    lines.forEach((text, i) => {
      if (COMMENT_LINE.test(text)) return;
      const code = text.replace(/\s\/\/\s.*$/, "");
      if (
        rule.pattern!.test(code) &&
        !(rule.unless && rule.unless.test(code)) &&
        !(rule.exemptNear && everyMatchGoverned(code, rule.pattern!, rule.exemptNear, i > 0 && !COMMENT_LINE.test(lines[i - 1]) ? lines[i - 1] : ""))
      ) {
        out.push({ rule: rule.id, file, line: i + 1, text: text.trim().slice(0, 160) });
      }
    });
  }
  out.push(...scanAnalyticsCalls(file, content));
  out.push(...scanAiHandTyped(file, content));
  return out;
}

/** Health-field names that must never be passed to an analytics or tracking call (S87). */
const ANALYTICS_FN = "track|trackEvent|trackScreen|logEvent|capture|gtag|fbq";
const ANALYTICS_CALL = /\b(track|trackEvent|trackScreen|logEvent|analytics\.\w+|posthog\.capture|mixpanel\.track|amplitude\.track|gtag|fbq)\s*\(/g;
const HEALTH_FIELD = /\b(reading|readings|bp|systolic|diastolic|glucose|condition|diagnosis|medication|medications)\b\s*[:,}]|["'](reading|bp|glucose|condition|diagnosis|medication)["']/i;
/** Packages whose default or namespace import is an analytics client (`import ph from "posthog-js"` then `ph.capture(...)`). */
const ANALYTICS_CLIENT_PACKAGE = /^(posthog-js|posthog-node|posthog-react-native|mixpanel-browser|mixpanel-react-native|react-native-mixpanel|amplitude-js|@amplitude\/[\w-]+|@segment\/[\w-]+|analytics|analytics-node|react-ga4?|@vercel\/analytics(\/[\w-]+)?|@react-native-firebase\/analytics|expo-firebase-analytics)$/;

/** Names that refer to an analytics function or client under another name (import alias, destructured or re-assigned). */
export function analyticsAliases(content: string): { fns: string[]; clients: string[] } {
  const fns = new Set<string>();
  const clients = new Set<string>();
  // import { track as t, logEvent as le } from "..."
  for (const m of content.matchAll(/import\s+(?:type\s+)?(?:\w+\s*,\s*)?\{([^}]*)\}\s*from\s*["'][^"']+["']/g)) {
    for (const spec of m[1].split(",")) {
      const a = spec.trim().match(new RegExp(`^(?:${ANALYTICS_FN})\\s+as\\s+(\\w+)$`));
      if (a) fns.add(a[1]);
    }
  }
  // const t = track;  const t = analytics.track;  const t = posthog.capture.bind(posthog)
  for (const m of content.matchAll(new RegExp(`(?:const|let|var)\\s+(\\w+)\\s*=\\s*(?:\\w+\\.)*(?:${ANALYTICS_FN})\\b(?!\\s*\\()`, "g"))) fns.add(m[1]);
  // const { track: t } = analytics;
  for (const m of content.matchAll(new RegExp(`(?:const|let|var)\\s*\\{([^}]*)\\}\\s*=`, "g"))) {
    for (const part of m[1].split(",")) {
      const a = part.trim().match(new RegExp(`^(?:${ANALYTICS_FN})\\s*:\\s*(\\w+)$`));
      if (a) fns.add(a[1]);
    }
  }
  // import ph from "posthog-js";  import * as mp from "mixpanel-browser";
  for (const m of content.matchAll(/import\s+(?:\*\s+as\s+)?(\w+)\s*(?:,\s*\{[^}]*\})?\s*from\s*["']([^"']+)["']/g)) {
    if (ANALYTICS_CLIENT_PACKAGE.test(m[2])) clients.add(m[1]);
  }
  for (const f of ANALYTICS_FN.split("|")) fns.delete(f);
  return { fns: [...fns], clients: [...clients] };
}

/** The text of the call starting at `open` (the index of its "("), up to the matching ")". Strings and comments are skipped. */
export function balancedCallText(content: string, open: number): string {
  let depth = 0;
  let i = open;
  const limit = Math.min(content.length, open + 6000);
  while (i < limit) {
    const c = content[i];
    if (c === '"' || c === "'" || c === "`") {
      const q = c;
      i++;
      while (i < limit && content[i] !== q) {
        if (content[i] === "\\") i++;
        i++;
      }
    } else if (c === "/" && content[i + 1] === "/") {
      while (i < limit && content[i] !== "\n") i++;
    } else if (c === "/" && content[i + 1] === "*") {
      const e = content.indexOf("*/", i + 2);
      i = e === -1 ? limit : e + 1;
    } else if (c === "(") depth++;
    else if (c === ")") {
      depth--;
      if (depth === 0) return content.slice(open, i + 1);
    }
    i++;
  }
  return content.slice(open, limit); // unbalanced: judge what we saw, never silently skip
}

export function scanAnalyticsCalls(file: string, content: string): PartCViolation[] {
  const out: PartCViolation[] = [];
  const { fns, clients } = analyticsAliases(content);
  const starts: number[] = [];
  for (const m of content.matchAll(ANALYTICS_CALL)) starts.push((m.index ?? 0) + m[0].lastIndexOf("("));
  for (const f of fns) for (const m of content.matchAll(new RegExp(`(?<![\\w.])${f}\\s*\\(`, "g"))) starts.push((m.index ?? 0) + m[0].lastIndexOf("("));
  for (const c of clients) for (const m of content.matchAll(new RegExp(`\\b${c}\\.\\w+\\s*\\(`, "g"))) starts.push((m.index ?? 0) + m[0].lastIndexOf("("));
  const seen = new Set<number>();
  for (const open of starts.sort((a, b) => a - b)) {
    if (seen.has(open)) continue;
    seen.add(open);
    const call = balancedCallText(content, open);
    if (HEALTH_FIELD.test(call)) {
      out.push({ rule: "analytics-health-field", file, line: content.slice(0, open).split("\n").length, text: call.replace(/\s+/g, " ").slice(0, 160) });
    }
  }
  return out;
}

/**
 * A screen that types its own "AI-drafted" words instead of rendering the shared `AiLabel` drifts from the others.
 * Only non-comment lines in .tsx files count; the shared label itself lives in `components/ai/ai-label.tsx`.
 */
const AI_HAND_TYPED = /AI-drafted|AI drafted|drafted by AI|written by AI/i;
export function scanAiHandTyped(file: string, content: string): PartCViolation[] {
  if (!/\.tsx$/.test(file) || /ai-label\.tsx$/.test(file)) return [];
  const out: PartCViolation[] = [];
  content.split("\n").forEach((text, i) => {
    if (COMMENT_LINE.test(text)) return;
    if (AI_HAND_TYPED.test(text)) out.push({ rule: "ai-label", file, line: i + 1, text: text.trim().slice(0, 160) });
  });
  return out;
}

const AI_LABEL_USED = /<AiLabel\b|\{AI_LABEL_TEXT\.\w+\}/;

/**
 * A surface passes when it renders the shared label itself, or renders a component that is known to (`renderers`, the verified
 * names from `RENDERS_AI_LABEL`). The surfaces themselves come from `AI_SYSTEM_SURFACES` (see `ai-surfaces.ts`).
 */
export function scanAiSurface(file: string, content: string, renderers: readonly string[] = []): PartCViolation[] {
  if (AI_LABEL_USED.test(content)) return [];
  if (renderers.some((name) => new RegExp(`<${name}\\b`).test(content))) return [];
  return [{ rule: "ai-label", file, line: 1, text: "renders model-generated text without the shared AiLabel" }];
}

/**
 * Resolve each name in `RENDERS_AI_LABEL` to the file(s) that define it and keep only those that really render `AiLabel`. A name
 * with no defining file is skipped (absent on this branch); a defining file that does not render the label is a violation.
 */
export function verifiedLabelRenderers(files: ReadonlyMap<string, string>, names: readonly string[]): { names: string[]; violations: PartCViolation[] } {
  const ok: string[] = [];
  const violations: PartCViolation[] = [];
  for (const name of names) {
    const def = new RegExp(`export\\s+(?:default\\s+)?(?:function|const|class)\\s+${name}\\b`);
    const defining = [...files].filter(([f, c]) => /\.tsx$/.test(f) && def.test(c));
    if (defining.length === 0) continue;
    const bad = defining.filter(([, c]) => !AI_LABEL_USED.test(c));
    if (bad.length > 0) bad.forEach(([f]) => violations.push({ rule: "ai-label", file: f, line: 1, text: `${name} is listed in RENDERS_AI_LABEL but does not render AiLabel` }));
    else ok.push(name);
  }
  return { names: ok, violations };
}

const AD_SDK = /admob|mobile-ads|appsflyer|applovin|ironsource|unity-ads|fbsdk|facebook-sdk|facebook-ads/i;

/**
 * Analytics and tracking SDK packages, matched as package-name tokens, never as bare substrings, so
 * `@react-native-segmented-control/segmented-control`, `heap-js`, `segment-tree`, `pixel-ratio` or `branch-name` stay clean.
 * Three forms: an npm scope that is a tracker, an exact package name, or a brand token (the name split on `/ - _ . @`
 * equals the brand). Add a new tracker to the lists, not a looser regex.
 */
const TRACKER_SCOPES: readonly string[] = [
  "@segment", "@amplitude", "@mixpanel", "@posthog", "@hotjar", "@fullstory", "@logrocket", "@heap", "@braze", "@adjustcom",
  "@statsig", "@launchdarkly", "@tiktok", "@june-so", "@microsoft/clarity", "@microsoft/react-native-clarity",
  "@vercel/analytics", "@react-native-firebase/analytics", "@datadog/browser-rum", "@datadog/mobile-react-native",
  "@next/third-parties", "@analytics", "@plausible",
];
const TRACKER_PACKAGES: ReadonlySet<string> = new Set([
  "analytics", "analytics-node", "react-ga", "react-ga4", "react-gtm-module", "react-gtag", "gtag", "vue-gtag", "ga-gtag",
  "expo-firebase-analytics", "heap-analytics", "react-native-heap", "clarity-js", "react-native-clarity",
  "react-facebook-pixel", "react-tiktok-pixel", "react-snapchat-pixel", "react-pinterest-tag", "react-linkedin-insight",
  "react-native-branch", "branch-sdk", "react-native-adjust", "adjust-sdk", "react-native-appboy-sdk", "react-native-onesignal",
  "react-onesignal", "onesignal-expo-plugin", "react-native-tiktok", "tiktok-business-sdk", "next-plausible", "plausible-tracker",
  "matomo-tracker", "react-matomo", "statsig-js", "statsig-react", "statsig-react-native", "launchdarkly-js-client-sdk",
  "launchdarkly-react-client-sdk", "react-native-mixpanel", "mixpanel-react-native", "amplitude-js",
]);
const TRACKER_BRAND_TOKENS: ReadonlySet<string> = new Set([
  "mixpanel", "amplitude", "posthog", "hotjar", "fullstory", "logrocket", "onesignal", "matomo", "plausible", "statsig",
  "launchdarkly", "braze", "appboy",
]);
/** Anything matching must be in TRACKER_ALLOWLIST or the scan fails. */
export function isTrackerPackage(name: string): boolean {
  const n = name.toLowerCase();
  if (TRACKER_PACKAGES.has(n)) return true;
  if (TRACKER_SCOPES.some((s) => n === s || n.startsWith(`${s}/`))) return true;
  const tokens = n.split(/[\/\-_.@]+/).filter(Boolean);
  if (tokens.some((t) => TRACKER_BRAND_TOKENS.has(t))) return true;
  // Firebase analytics under any wrapper name: the tokens "firebase" and "analytics" both present.
  return tokens.includes("firebase") && tokens.includes("analytics");
}
/** Explicit allowlist of tracker-like packages (none today). A package here needs a decision in `docs/DECISIONS.md`. */
export const TRACKER_ALLOWLIST: readonly string[] = [];

/** Ad and marketing SDKs are banned as dependencies (D.3). */
export function scanPackageJson(file: string, content: string): PartCViolation[] {
  let deps: string[] = [];
  try {
    const j = JSON.parse(content) as Record<string, Record<string, string> | undefined>;
    deps = [...Object.keys(j.dependencies ?? {}), ...Object.keys(j.devDependencies ?? {})];
  } catch {
    return [];
  }
  return [
    ...deps.filter((d) => AD_SDK.test(d)).map((d) => ({ rule: "ad-sdk", file, line: 1, text: d })),
    ...deps
      .filter((d) => isTrackerPackage(d) && !AD_SDK.test(d) && !TRACKER_ALLOWLIST.includes(d))
      .map((d) => ({ rule: "tracker-sdk", file, line: 1, text: d })),
  ];
}

export function scanRepo(repoRoot: string): PartCViolation[] {
  const out: PartCViolation[] = [];
  const files = new Map<string, string>();
  for (const r of SOURCE_ROOTS) {
    const root = join(repoRoot, r);
    if (!existsSync(root)) continue;
    for (const file of walk(root)) {
      const rel = relative(repoRoot, file);
      const content = readFileSync(file, "utf8");
      files.set(rel, content);
      out.push(...scanText(rel, content));
    }
  }
  const renderers = verifiedLabelRenderers(files, RENDERS_AI_LABEL);
  out.push(...renderers.violations);
  for (const surface of AI_SURFACES) {
    const p = join(repoRoot, surface);
    out.push(
      ...(existsSync(p)
        ? scanAiSurface(surface, readFileSync(p, "utf8"), renderers.names)
        : [{ rule: "ai-label", file: surface, line: 1, text: "AI surface file is missing: update AI_SYSTEM_SURFACES" }]),
    );
  }
  const registry = join(repoRoot, AI_REGISTRY_FILE);
  if (existsSync(registry)) {
    const registrySource = readFileSync(registry, "utf8");
    out.push(...scanAiSystemMap(registrySource), ...scanAiCallSites(files, registrySource));
    out.push(...scanAiRenderingCandidates(files));
  } else {
    out.push({ rule: "ai-label", file: AI_REGISTRY_FILE, line: 1, text: "the AI system registry file is missing: update AI_REGISTRY_FILE" });
  }
  for (const pj of ["package.json", ...["apps", "packages"].flatMap((d) => {
    const dir = join(repoRoot, d);
    return existsSync(dir) ? readdirSync(dir).map((n) => `${d}/${n}/package.json`) : [];
  })]) {
    const p = join(repoRoot, pj);
    if (existsSync(p)) out.push(...scanPackageJson(pj, readFileSync(p, "utf8")));
  }
  return out;
}
