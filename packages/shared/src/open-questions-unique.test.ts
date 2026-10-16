import { describe, expect, it } from "@jest/globals";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

// Parallel sessions once handed out the same OQ number for unrelated topics (225 repeats by 2026-10-16),
// so a citation like "OQ-310" could mean five different things. Every `### OQ-<id>` heading must be unique.
const FILE = join(fileURLToPath(new URL(".", import.meta.url)), "..", "..", "..", "docs", "OPEN-QUESTIONS.md");

describe("docs/OPEN-QUESTIONS.md", () => {
  it("has no repeated OQ heading id", () => {
    const seen = new Map<string, number>();
    const dups: string[] = [];
    readFileSync(FILE, "utf8")
      .split("\n")
      .forEach((line, i) => {
        const m = /^#{2,6}\s+(OQ-[A-Za-z0-9]+(?:-[A-Za-z0-9]+)*)\b(?=\s+[A-Za-z`(])/.exec(line);
        if (!m) return;
        const first = seen.get(m[1]);
        if (first !== undefined) dups.push(`${m[1]} at line ${i + 1} (first at line ${first})`);
        else seen.set(m[1], i + 1);
      });
    expect(dups).toEqual([]);
  });
});
