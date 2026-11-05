import { describe, expect, it } from "@jest/globals";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { getProposedConfig } from "./index";

/**
 * T2-13 cleanup (2026-11-04): marketing.membership_ladder_public is retired. Membership Plus is no longer sold (T2-01), so there is no
 * ladder to make public, and no application code may read the key. Tests may still mock it (they prove a page ignores it).
 */
const ROOT = join(fileURLToPath(new URL(".", import.meta.url)), "..", "..", "..", "..");
const KEY = "marketing.membership_ladder_public";

function sourceFiles(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    if (name === "node_modules" || name.startsWith(".")) continue;
    const p = join(dir, name);
    if (statSync(p).isDirectory()) sourceFiles(p, out);
    else if (/\.(ts|tsx)$/.test(name) && !/\.test\.tsx?$/.test(name)) out.push(p);
  }
  return out;
}

const readers = (files: readonly string[]) => files.filter((f) => readFileSync(f, "utf8").includes(KEY)).map((f) => f.slice(ROOT.length + 1));

describe("marketing.membership_ladder_public is retired", () => {
  it("is switched off and marked retired in the newest version", () => {
    const v = getProposedConfig(KEY).value as { enabled: boolean; retired?: boolean };
    expect(v).toEqual({ enabled: false, retired: true });
  });

  it("no web or mobile application file reads it", () => {
    const files = [...sourceFiles(join(ROOT, "apps", "web", "src")), ...sourceFiles(join(ROOT, "apps", "mobile", "src"))];
    expect(files.length).toBeGreaterThan(100);
    expect(readers(files)).toEqual([]);
  });

  it("sabotage: a file that reads the key is caught", () => {
    const tmp = join(ROOT, "packages", "shared", "src", "proposed-config", "registry.ts");
    expect(readers([tmp])).toEqual(["packages/shared/src/proposed-config/registry.ts"]);
  });
});
