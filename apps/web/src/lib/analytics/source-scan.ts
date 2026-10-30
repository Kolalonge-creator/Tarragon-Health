/**
 * Helper for the source-scan tests in this folder (queries-guard.test.ts,
 * self-reporting-pages.test.ts). Not imported by application code.
 *
 * Returns the file with comments removed, so a scan reads code and not prose.
 * The header comment of queries.ts deliberately quotes the bare call it
 * forbids, and a scan that counted that as a violation would force the
 * explanation out of the one place a developer looks.
 *
 * Block comments and whole-line `//` comments only. A trailing `// ...` after
 * code is left alone, because stripping it would also eat a `//` inside a
 * string such as a URL.
 */
export function codeOnly(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .split("\n")
    .filter((line) => !/^\s*\/\//.test(line))
    .join("\n");
}
