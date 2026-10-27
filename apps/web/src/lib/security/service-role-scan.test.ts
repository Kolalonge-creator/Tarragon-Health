import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";

/**
 * W-36: the service-role key bypasses row security, so every file that can use it is listed in
 * docs/security/service-role-allowlist.json (and explained in docs/security/service-role-inventory.md).
 * A NEW file that uses createServiceRoleClient or reads the service-role key fails here until someone
 * adds it to the list with a reason. Existing files are baselined; removing one is always fine.
 */
const REPO_ROOT = join(__dirname, "..", "..", "..", "..", "..");
const SCAN_DIRS = ["apps/web/src", "apps/mobile/src", "apps/console/src", "packages", "supabase/functions", "scripts"];
const PATTERN = /createServiceRoleClient|SERVICE_ROLE_KEY/;

function files(dir: string): string[] {
  let entries: string[];
  try {
    entries = readdirSync(dir);
  } catch {
    return [];
  }
  return entries.flatMap((entry) => {
    if (entry === "node_modules" || entry === ".next" || entry === ".expo") return [];
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) return files(full);
    if (!/\.(ts|tsx|mjs|js)$/.test(entry)) return [];
    if (/\.test\.|\.d\.ts$|database\.types/.test(entry) || /__tests__|\/e2e/.test(full)) return [];
    return [full];
  });
}

function usingFiles(): string[] {
  return SCAN_DIRS.flatMap((d) => files(join(REPO_ROOT, d)))
    .filter((f) => PATTERN.test(readFileSync(f, "utf8")))
    .map((f) => relative(REPO_ROOT, f))
    .sort();
}

const allow: { files: { file: string; category: string }[] } = JSON.parse(
  readFileSync(join(REPO_ROOT, "docs/security/service-role-allowlist.json"), "utf8"),
);
const allowed = new Set(allow.files.map((f) => f.file));

describe("service-role allowlist (W-36)", () => {
  it("every file that uses the service-role key is on the allowlist", () => {
    const unlisted = usingFiles().filter((f) => !allowed.has(f));
    expect(unlisted).toEqual([]);
  });

  it("every allowlist entry has a category", () => {
    expect(allow.files.filter((f) => !f.category.trim())).toEqual([]);
  });

  it("the scan is not vacuous: it finds the factory and a known edge function", () => {
    const found = usingFiles();
    expect(found).toContain("packages/auth/src/supabase/service-role.ts");
    expect(found.some((f) => f.startsWith("supabase/functions/"))).toBe(true);
  });
});
