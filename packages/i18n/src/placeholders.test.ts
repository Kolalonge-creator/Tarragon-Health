import { readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "@jest/globals";
import { en, t } from "./index";

/**
 * OQ-430: the helper fills `{name}` only. A string written `{{name}}` printed its braces, and a call that forgot a param printed `{amount}`.
 * This fails on any new string using double braces, and on any literal-key call site that passes no params, or too few, for a string that has them.
 * It reads source text (single-line calls only), so a call built over several lines or through a variable is not seen: keep those rare.
 */
const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const SKIP = new Set(["node_modules", ".next", "ios", "android", "dist", "build", ".expo", "coverage"]);

function sources(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    if (SKIP.has(name)) continue;
    const p = join(dir, name);
    const st = statSync(p);
    if (st.isDirectory()) sources(p, out);
    else if (/\.tsx?$/.test(name) && !/\.test\.tsx?$/.test(name) && !/\.d\.ts$/.test(name)) out.push(p);
  }
  return out;
}

const params = (s: string): string[] => [...new Set([...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1] as string))];
const entries = Object.entries(en) as [string, string][];

describe("i18n placeholders (OQ-430)", () => {
  it("no string uses double braces, which the helper never fills", () => {
    expect(entries.filter(([, v]) => v.includes("{{") || v.includes("}}")).map(([k]) => k)).toEqual([]);
  });

  it("no string has a stray brace that is not a {name} placeholder", () => {
    const stray = entries.filter(([, v]) => v.replace(/\{\w+\}/g, "").match(/[{}]/)).map(([k]) => k);
    expect(stray).toEqual([]);
  });

  it("the helper fills every placeholder it is given and leaves a missing one visible", () => {
    expect(t("admin.refunds.confirm_approve", "en", { amount: "₦5,000" })).toContain("₦5,000");
    expect(t("admin.refunds.confirm_approve", "en", { amount: "₦5,000" })).not.toMatch(/[{}]/);
  });

  const files = [...sources(join(ROOT, "apps")), ...sources(join(ROOT, "packages"))];
  const withParams = new Map(entries.map(([k, v]) => [k, params(v)] as const).filter(([, p]) => p.length > 0));
  // t("key"), t("key", locale), tr("key"): no params argument at all
  const NO_ARGS = /(?<![\w$])(?:t|tr)\(\s*"([\w.]+)"\s*(?:,\s*[\w.]+\s*)?\)/g;
  // t("key", locale, { a, b: 1 }) with a flat inline object
  const INLINE = /(?<![\w$])(?:t|tr)\(\s*"([\w.]+)"\s*(?:,\s*[\w.]+\s*)?,\s*\{([^{}]*)\}\s*\)/g;

  it("scans a real set of source files", () => {
    expect(files.length).toBeGreaterThan(500);
  });

  it("no call site passes no params for a string that has placeholders", () => {
    const bad: string[] = [];
    for (const f of files) {
      const text = readFileSync(f, "utf8");
      for (const m of text.matchAll(NO_ARGS)) if (withParams.has(m[1] as string)) bad.push(`${f.slice(ROOT.length)}: ${m[1]}`);
    }
    expect(bad).toEqual([]);
  });

  it("no inline-params call site leaves a placeholder out", () => {
    const bad: string[] = [];
    for (const f of files) {
      const text = readFileSync(f, "utf8");
      for (const m of text.matchAll(INLINE)) {
        const need = withParams.get(m[1] as string);
        if (!need) continue;
        const given = [...(m[2] as string).matchAll(/(?:^|,)\s*(\w+)\s*(?::|(?=,)|$)/g)].map((x) => x[1] as string);
        const missing = need.filter((n) => !given.includes(n));
        if (missing.length > 0) bad.push(`${f.slice(ROOT.length)}: ${m[1]} missing ${missing.join(",")}`);
      }
    }
    expect(bad).toEqual([]);
  });
});
