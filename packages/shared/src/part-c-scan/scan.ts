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
    reason: "care packs never auto-renew; only a negation may mention it",
    pattern: /auto-?renew/i,
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
    reason: "any file that shows a fertile window must also carry the words 'Not contraception'",
    whenFile: /fertile window/i,
    requireFile: /not contraception/i,
  },
  {
    id: "patient-sms",
    part: "C.2",
    reason: "SMS is for verification codes and clinician paging only",
    pattern: /(channel|value):\s*["']sms["']|sendPatientLinkSms\(/,
    unless: /\|/, // a type union such as `"sms" | "email"` is a declaration, not a send
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
  return out;
}

const AD_SDK = /admob|mobile-ads|appsflyer|applovin|ironsource|unity-ads|fbsdk|facebook-sdk|facebook-ads/i;

/** Ad and marketing SDKs are banned as dependencies (D.3). */
export function scanPackageJson(file: string, content: string): PartCViolation[] {
  let deps: string[] = [];
  try {
    const j = JSON.parse(content) as Record<string, Record<string, string> | undefined>;
    deps = [...Object.keys(j.dependencies ?? {}), ...Object.keys(j.devDependencies ?? {})];
  } catch {
    return [];
  }
  return deps
    .filter((d) => AD_SDK.test(d))
    .map((d) => ({ rule: "ad-sdk", file, line: 1, text: d }));
}

export function scanRepo(repoRoot: string): PartCViolation[] {
  const out: PartCViolation[] = [];
  for (const r of SOURCE_ROOTS) {
    const root = join(repoRoot, r);
    if (!existsSync(root)) continue;
    for (const file of walk(root)) out.push(...scanText(relative(repoRoot, file), readFileSync(file, "utf8")));
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
