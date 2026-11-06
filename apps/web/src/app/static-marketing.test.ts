import { readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * Files that sit in EVERY marketing page's tree. If one of them reads the request (headers, cookies, connection, a forced
 * dynamic export), every marketing page stops being static and Vercel serves them all uncached (2026-11-06: one
 * `await connection()` in the root not-found did exactly that). The post-build check `scripts/assert-static-marketing.ts`
 * catches the same thing from the build output; this test catches it before a build.
 */
const SHARED_TREE_FILES = ["app/layout.tsx", "app/not-found.tsx", "app/(marketing)/layout.tsx"];
const DYNAMIC_APIS = [/\bconnection\s*\(/, /\bheaders\s*\(\s*\)/, /\bcookies\s*\(\s*\)/, /\bdraftMode\s*\(/, /export\s+const\s+dynamic\s*=\s*["']force-dynamic["']/];

describe("shared marketing tree stays static", () => {
  it.each(SHARED_TREE_FILES)("%s reads nothing from the request", (file) => {
    const source = readFileSync(join(__dirname, "..", file), "utf8").replace(/^\s*\/\/.*$/gm, "");
    for (const pattern of DYNAMIC_APIS) expect(source).not.toMatch(pattern);
  });
});
