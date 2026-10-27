import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";

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
  /** A line matching this is not a violation (for example a negation such as "nothing auto-renews"). */
  readonly unless?: RegExp;
  /** File-level rule: flag a file that matches `whenFile` but never matches `requireFile`. */
  readonly whenFile?: RegExp;
  readonly requireFile?: RegExp;
  /** Only files whose repo-relative path matches are scanned by this rule. */
  readonly files?: RegExp;
  /** Files whose path matches are exempt from this rule (stated, with the reason, next to the rule). */
  readonly exemptFiles?: RegExp;
}

/** Marketing pages and the copy catalogues (S87 claims scan). */
const MARKETING_COPY = /^apps\/web\/src\/app\/\(marketing\)\/|^packages\/i18n\/src\/(?!.*\.test\.)/;
const DEBUNKING = /\bmiracle\b|marketed as|\bmyths?\b|aren'?t|isn'?t/i;
const NEGATION = /\b(no|nothing|never|not|without|cannot|can't|doesn't|does not|don't|isn't|off)\b/i;

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
    unless: /\b(no|nothing|never|not|without|off)\b/i,
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
    unless: new RegExp(`${NEGATION.source}|${DEBUNKING.source}`, "i"),
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
    unless: NEGATION,
  },
  {
    id: "paystack-recurring",
    part: "C.1",
    reason:
      "no Paystack plan or subscription creation call: nothing may start recurring billing. Known dormant webhook handlers are allowlisted with an open question",
    exemptFiles: /^supabase\/functions\/paystack-webhook\/(index|test-fake-supabase)\.ts$/,
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
      if (rule.pattern!.test(code) && !(rule.unless && rule.unless.test(code))) {
        out.push({ rule: rule.id, file, line: i + 1, text: text.trim().slice(0, 160) });
      }
    });
  }
  out.push(...scanAnalyticsCalls(file, content));
  out.push(...scanAiHandTyped(file, content));
  return out;
}

/** Health-field names that must never be passed to an analytics or tracking call (S87). */
const ANALYTICS_CALL = /\b(track|trackEvent|logEvent|analytics\.\w+|posthog\.capture|mixpanel\.track|amplitude\.track|gtag|fbq)\s*\(/g;
const HEALTH_FIELD = /\b(reading|readings|bp|systolic|diastolic|glucose|condition|diagnosis|medication|medications)\b\s*[:,}]|["'](reading|bp|glucose|condition|diagnosis|medication)["']/i;

export function scanAnalyticsCalls(file: string, content: string): PartCViolation[] {
  const out: PartCViolation[] = [];
  for (const m of content.matchAll(ANALYTICS_CALL)) {
    const start = m.index ?? 0;
    const end = content.indexOf(");", start);
    const call = content.slice(start, end === -1 ? start + 300 : Math.min(end, start + 400));
    if (HEALTH_FIELD.test(call)) {
      out.push({ rule: "analytics-health-field", file, line: content.slice(0, start).split("\n").length, text: call.replace(/\s+/g, " ").slice(0, 160) });
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

/**
 * Every surface that renders model-generated text, found from the registered AI call sites (`runGovernedAi`):
 * case brief, reply draft, appointment prep, service navigation, result explainer, report extraction, vaccination card
 * import, the scribe draft, the patient coach (web and phone). Each must render the shared label. Add a surface here
 * when a new AI call site gets a screen.
 */
export const AI_SURFACES: readonly string[] = [
  "apps/web/src/components/case-brief-card.tsx",
  "apps/web/src/components/draft-reply-card.tsx",
  "apps/web/src/app/(dashboard)/patient/video-visit/[consultationId]/appointment-prep-helper.tsx",
  "apps/web/src/app/(dashboard)/patient/service-navigation-assistant.tsx",
  "apps/web/src/components/result-explainer.tsx",
  "apps/web/src/app/(dashboard)/clinician/patients/[patientId]/lab-report-extraction-panel.tsx",
  "apps/web/src/app/(dashboard)/patient/vaccination-card-import.tsx",
  "apps/web/src/components/scribe/draft-review-panel.tsx",
  "apps/web/src/app/(dashboard)/patient/ai-coach-chat.tsx",
  "apps/mobile/src/screens/sections/ai-coach-screen.tsx",
];
const AI_LABEL_USED = /<AiLabel\b|\{AI_LABEL_TEXT\.\w+\}/;

export function scanAiSurface(file: string, content: string): PartCViolation[] {
  return AI_LABEL_USED.test(content)
    ? []
    : [{ rule: "ai-label", file, line: 1, text: "renders model-generated text without the shared AiLabel" }];
}

const AD_SDK = /admob|mobile-ads|appsflyer|applovin|ironsource|unity-ads|fbsdk|facebook-sdk|facebook-ads/i;
/** Analytics and tracking SDK packages. Anything matching must be in TRACKER_ALLOWLIST or the scan fails. */
const TRACKER_SDK =
  /segment|mixpanel|amplitude|posthog|google-analytics|react-ga|gtag|firebase.*analytics|analytics.*firebase|@vercel\/analytics|hotjar|clarity|fullstory|logrocket|heap-?analytics|braze|onesignal|branch-?sdk|react-native-branch|adjust-?sdk|react-native-adjust|tiktok|snapchat|facebook|pixel|datadog.*rum|plausible|matomo|@statsig|launchdarkly/i;
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
      .filter((d) => TRACKER_SDK.test(d) && !AD_SDK.test(d) && !TRACKER_ALLOWLIST.includes(d))
      .map((d) => ({ rule: "tracker-sdk", file, line: 1, text: d })),
  ];
}

export function scanRepo(repoRoot: string): PartCViolation[] {
  const out: PartCViolation[] = [];
  for (const r of SOURCE_ROOTS) {
    const root = join(repoRoot, r);
    if (!existsSync(root)) continue;
    for (const file of walk(root)) out.push(...scanText(relative(repoRoot, file), readFileSync(file, "utf8")));
  }
  for (const surface of AI_SURFACES) {
    const p = join(repoRoot, surface);
    out.push(...(existsSync(p) ? scanAiSurface(surface, readFileSync(p, "utf8")) : [{ rule: "ai-label", file: surface, line: 1, text: "AI surface file is missing: update AI_SURFACES" }]));
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
