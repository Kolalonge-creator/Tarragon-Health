// Run after `next build`: fails if any public marketing page was built as a per-request (dynamic) page instead of a static one.
// A dynamic marketing page is served by Vercel as private/no-store, never from its cache, which costs about a second on a slow
// phone (found 2026-11-06: one `await connection()` in the root not-found made every page dynamic). Reads the build's own
// prerender manifest, so it checks what will actually ship.
import { readFileSync } from "node:fs";
import { MARKETING_ROUTES, MARKETING_ROUTES_BUILT } from "../src/lib/marketing/routes.ts";

const manifest = JSON.parse(readFileSync(new URL("../.next/prerender-manifest.json", import.meta.url), "utf8"));
const prerendered = new Set(Object.keys(manifest.routes));
const expected = [...new Set(MARKETING_ROUTES_BUILT.map((key) => MARKETING_ROUTES[key].split("#")[0]))];
const dynamic = expected.filter((path) => !prerendered.has(path));
if (dynamic.length > 0) {
  console.error(`These marketing pages were built as dynamic, so Vercel will not cache them:\n  ${dynamic.join("\n  ")}`);
  console.error("Look for headers(), cookies(), connection(), searchParams or `dynamic = \"force-dynamic\"` in the page or a shared file (root layout, marketing layout, root not-found).");
  process.exit(1);
}
console.log(`All ${expected.length} marketing pages are static.`);
