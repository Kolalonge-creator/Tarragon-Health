/** @jest-environment node */
import { afterEach, describe, expect, it } from "@jest/globals";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { isCronAuthorised, isSameSecret } from "./cron-auth";

const saved = process.env.CRON_SECRET;
afterEach(() => {
  if (saved === undefined) delete process.env.CRON_SECRET;
  else process.env.CRON_SECRET = saved;
});

describe("isCronAuthorised", () => {
  it("accepts only the exact bearer secret", () => {
    process.env.CRON_SECRET = "s3cret";
    expect(isCronAuthorised("Bearer s3cret")).toBe(true);
    expect(isCronAuthorised("Bearer s3cre")).toBe(false);
    expect(isCronAuthorised("Bearer s3cret2")).toBe(false);
    expect(isCronAuthorised("s3cret")).toBe(false);
    expect(isCronAuthorised(null)).toBe(false);
  });
  it("refuses everything when no secret is configured, even the literal word undefined", () => {
    delete process.env.CRON_SECRET;
    expect(isCronAuthorised("Bearer undefined")).toBe(false);
    expect(isCronAuthorised("Bearer ")).toBe(false);
  });
});

describe("isSameSecret", () => {
  it("accepts only identical non-empty values", () => {
    expect(isSameSecret("abc", "abc")).toBe(true);
    expect(isSameSecret("abc", "abd")).toBe(false);
    expect(isSameSecret("abc", "abcd")).toBe(false);
    expect(isSameSecret("", "")).toBe(false);
    expect(isSameSecret(null, "abc")).toBe(false);
    expect(isSameSecret("abc", undefined)).toBe(false);
  });
});

// Security audit 2026-11-05, L-1: no route may compare a secret with !== or ===, which leaks timing. Use
// isCronAuthorised / isSameSecret instead.
describe("route secret comparisons", () => {
  it("no API route compares CRON_SECRET or an internal service key with a plain equality operator", () => {
    const apiDir = join(__dirname, "..", "app", "api");
    const routes = (readdirSync(apiDir, { recursive: true }) as string[]).filter((f) => f.endsWith("route.ts"));
    const offenders = routes.filter((file) => {
      const src = readFileSync(join(apiDir, file), "utf8");
      return /CRON_SECRET\}?`?\s*[!=]==|[!=]==\s*`Bearer \$\{process\.env\.CRON_SECRET|provided\s*[!=]==\s*expected/.test(src);
    });
    expect(offenders).toEqual([]);
  });
});
