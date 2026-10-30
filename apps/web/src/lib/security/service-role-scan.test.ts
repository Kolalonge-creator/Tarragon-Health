import { readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, normalize, relative } from "node:path";

/**
 * W-36: the service-role key bypasses row security, so every file that can use it is listed in
 * docs/security/service-role-allowlist.json (and explained in docs/security/service-role-inventory.md).
 *
 *  - A NEW file that uses createServiceRoleClient or reads the service-role key fails until it is added with a reason.
 *  - A NEW file that imports one of the listed helper wrappers (modules that call the key for their callers) fails until it is added to
 *    wrapper_callers, so a transitive use gets a review too.
 *  - A listed file that no longer exists or no longer uses the key fails: prune the entry (the list must not rot).
 */
const REPO_ROOT = join(__dirname, "..", "..", "..", "..", "..");
const SCAN_ROOTS = ["apps/web/src", "apps/mobile/src", "apps/console/src", "packages", "supabase/functions", "scripts", "tools", "services", ".github/workflows"];
const SKIP_DIRS = new Set(["node_modules", ".next", ".expo", "dist", "build", ".turbo", "coverage", ".vercel"]);
const PATTERN = /createServiceRoleClient|SERVICE_ROLE_KEY/;

function walk(dir: string): string[] {
  let entries: string[];
  try {
    entries = readdirSync(dir);
  } catch {
    return [];
  }
  return entries.flatMap((entry) => {
    if (SKIP_DIRS.has(entry)) return [];
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) return walk(full);
    const rel = relative(REPO_ROOT, full);
    const isWorkflow = rel.startsWith(".github/workflows");
    if (!(isWorkflow ? /\.(yml|yaml)$/ : /\.(ts|tsx|mjs|js|py)$/).test(entry)) return [];
    if (/\.test\.|\.d\.ts$|database\.types|_test\.py$|^test_/.test(entry) || /__tests__|\/e2e|\/tests\//.test(rel)) return [];
    return [rel];
  });
}

// Computed once: every source file in the scan roots, its text, and the subset that uses the key.
const ALL_FILES = SCAN_ROOTS.flatMap((r) => walk(join(REPO_ROOT, r))).sort();
const TEXT = new Map(ALL_FILES.map((f) => [f, readFileSync(join(REPO_ROOT, f), "utf8")]));
const USING = ALL_FILES.filter((f) => PATTERN.test(TEXT.get(f) ?? ""));

type Allowlist = { files: { file: string; category: string }[]; wrappers: string[]; wrapper_callers: string[] };
const allow: Allowlist = JSON.parse(readFileSync(join(REPO_ROOT, "docs/security/service-role-allowlist.json"), "utf8"));
const allowed = new Set(allow.files.map((f) => f.file));

function resolveImport(from: string, spec: string): string | null {
  if (spec.startsWith("@/")) return join("apps/web/src", spec.slice(2));
  if (spec.startsWith(".")) return normalize(join(dirname(from), spec));
  return null;
}

function importersOfWrappers(): string[] {
  const wrapperBases = new Set(allow.wrappers.map((w) => w.replace(/\.ts$/, "")));
  const hits: string[] = [];
  for (const f of ALL_FILES) {
    if (!f.startsWith("apps/web/src") || !/\.(ts|tsx)$/.test(f) || allow.wrappers.includes(f)) continue;
    for (const m of (TEXT.get(f) ?? "").matchAll(/(?:from|import)\s*\(?\s*["']([^"']+)["']/g)) {
      const p = resolveImport(f, m[1]);
      if (p && wrapperBases.has(p)) {
        hits.push(f);
        break;
      }
    }
  }
  return hits.sort();
}

describe("service-role allowlist (W-36)", () => {
  it("every file that uses the service-role key is on the allowlist", () => {
    expect(USING.filter((f) => !allowed.has(f))).toEqual([]);
  });

  it("every allowlist entry still exists and still uses the key (prune stale entries)", () => {
    const stale = allow.files.map((f) => f.file).filter((f) => !USING.includes(f));
    expect({ message: "These entries are stale. Remove them from docs/security/service-role-allowlist.json.", stale }).toEqual({
      message: "These entries are stale. Remove them from docs/security/service-role-allowlist.json.",
      stale: [],
    });
  });

  it("every allowlist entry has a category", () => {
    expect(allow.files.filter((f) => !f.category.trim())).toEqual([]);
  });

  it("every file that imports a helper wrapper is already reviewed (on the allowlist or in wrapper_callers)", () => {
    const reviewed = new Set([...allowed, ...allow.wrapper_callers]);
    expect(importersOfWrappers().filter((f) => !reviewed.has(f))).toEqual([]);
  });

  it("every listed wrapper exists, and every wrapper caller still imports one", () => {
    expect(allow.wrappers.filter((w) => !TEXT.has(w) && !statExists(w))).toEqual([]);
    const live = new Set(importersOfWrappers());
    expect(allow.wrapper_callers.filter((c) => !live.has(c))).toEqual([]);
  });

  it("the scan is not vacuous: it finds the factory, an edge function, and a CI workflow", () => {
    expect(USING).toContain("packages/auth/src/supabase/service-role.ts");
    expect(USING.some((f) => f.startsWith("supabase/functions/"))).toBe(true);
    expect(USING.some((f) => f.startsWith(".github/workflows/"))).toBe(true);
  });
});

function statExists(rel: string): boolean {
  try {
    statSync(join(REPO_ROOT, rel));
    return true;
  } catch {
    return false;
  }
}
