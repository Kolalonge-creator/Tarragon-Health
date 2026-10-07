import { describe, expect, it } from "@jest/globals";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

const dirs = [__dirname, join(__dirname, "../../../../lib/protocols")];

describe("titration protocols screen imports", () => {
  it("imports the evaluator only from the subpath, never the package index", () => {
    const files = dirs.flatMap((d) => readdirSync(d).filter((f) => /\.(ts|tsx)$/.test(f) && !f.endsWith(".test.ts")).map((f) => join(d, f)));
    expect(files.length).toBeGreaterThan(3);
    for (const f of files) {
      const src = readFileSync(f, "utf8");
      expect({ f, bad: /from\s+["']@tarragon\/clinical["']/.test(src) }).toEqual({ f, bad: false });
    }
  });
  it("the actions file does use the subpath", () => {
    expect(readFileSync(join(__dirname, "actions.ts"), "utf8")).toContain('from "@tarragon/clinical/titration"');
  });
});
