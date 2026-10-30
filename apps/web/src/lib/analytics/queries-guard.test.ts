import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "@jest/globals";

/**
 * A new analytics hook that parses its answer directly would quietly bypass
 * the refusal guard in ./answer and put the false zeros straight back for
 * that one dashboard, with every other test still green. The same shape of
 * scan guards StatTile call sites (components/ui/stat-tile-value.test.ts).
 */
describe("analytics hooks", () => {
  const source = readFileSync(join(process.cwd(), "src/lib/analytics/queries.ts"), "utf8");

  it("never parse an RPC answer directly", () => {
    // Everything goes through parseAnalyticsAnswer(schema, data). A bare
    // `Schema.parse(data)` is the exact shape this guard replaced.
    expect(source).not.toMatch(/\.parse\(/);
  });

  it("guard every read hook, one for one", () => {
    const reads = source.match(/useQuery\(/g) ?? [];
    const guarded = source.match(/parseAnalyticsAnswer\(/g) ?? [];
    expect(reads.length).toBeGreaterThan(0);
    expect(guarded.length).toBe(reads.length);
  });
});
