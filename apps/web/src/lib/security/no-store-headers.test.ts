/**
 * Security audit 2026-11-05 (L-6): signed-in areas and token-link pages are never cached. Checked against Next's own path
 * matcher, so a pattern Next would read differently fails here rather than silently caching a health page.
 */
import { describe, expect, it, jest } from "@jest/globals";

jest.mock("@sentry/nextjs", () => ({ withSentryConfig: (config: unknown) => config }));

type Rule = { source: string; headers: { key: string; value: string }[] };

async function rules(): Promise<Rule[]> {
  const mod = (await import("../../../next.config")) as { default: { headers: () => Promise<Rule[]> } };
  return mod.default.headers();
}

/** The Cache-Control a path ends up with: Next applies every matching rule in order and the last one wins. */
async function cacheControlFor(path: string): Promise<string | undefined> {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { getPathMatch } = require("next/dist/shared/lib/router/utils/path-match") as {
    getPathMatch: (source: string, opts?: { strict?: boolean; removeUnnamedParams?: boolean }) => (p: string) => unknown;
  };
  let value: string | undefined;
  for (const rule of await rules()) {
    if (getPathMatch(rule.source, { strict: true, removeUnnamedParams: true })(path) === false) continue;
    const header = rule.headers.find((h) => h.key === "Cache-Control");
    if (header) value = header.value;
  }
  return value;
}

describe("no-store on signed-in and token-link pages", () => {
  it.each([
    "/patient",
    "/patient/vitals",
    "/clinician/messages",
    "/admin/settings/members",
    "/account",
    "/emergency/abc123",
    "/share/sometoken",
    "/verify-rx/sometoken",
  ])("%s is never cached", async (path) => {
    expect(await cacheControlFor(path)).toBe("private, no-store, max-age=0");
  });

  it("leaves public marketing pages cacheable", async () => {
    expect(await cacheControlFor("/")).toBeUndefined();
    expect(await cacheControlFor("/pricing")).toBeUndefined();
    expect(await cacheControlFor("/patients-guide")).toBeUndefined();
  });

  it("keeps the stricter per-page rules winning on their own paths", async () => {
    const list = await rules();
    const broad = list.findIndex((r) => r.source.startsWith("/(patient|clinician|admin"));
    const speakUp = list.findIndex((r) => r.source === "/clinician/(quality/concerns|my-concerns)");
    expect(broad).toBeGreaterThan(list.findIndex((r) => r.source === "/(.*)"));
    expect(broad).toBeLessThan(speakUp);
  });
});
