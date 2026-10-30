/**
 * JSX text is not a string literal: "“" typed between tags prints the six characters, not a quote mark. The annual bundle card
 * showed “Your test requests” to patients this way. Write the character itself, or put the escape inside {"..."}.
 */
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

const ROOT = join(__dirname);
const RAW_ESCAPE_IN_TEXT = /^\s*[^\s"'`{}=<>/*][^"'`{}<>]*\\u[0-9a-fA-F]{4}/;

function tsxFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = join(dir, e.name);
    if (e.isDirectory()) return tsxFiles(p);
    return e.name.endsWith(".tsx") && !e.name.includes(".test.") ? [p] : [];
  });
}

describe("JSX text", () => {
  it("has no raw \\uXXXX escape sequences", () => {
    const offenders = tsxFiles(ROOT).flatMap((file) =>
      readFileSync(file, "utf8")
        .split("\n")
        .flatMap((line, i) => (RAW_ESCAPE_IN_TEXT.test(line) ? [`${file.slice(ROOT.length + 1)}:${i + 1}`] : [])),
    );
    expect(offenders).toEqual([]);
  });
});
