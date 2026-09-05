import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { SITE } from "./site";

/**
 * A source-text guard on every marketing page's <meta description> and title.
 *
 * Deliberately reads the source as TEXT rather than importing it: a `page.tsx`
 * pulls in the whole React/Next server-component graph, which does not load
 * under this Jest config (node environment, no RSC runtime), and the thing
 * worth protecting is a plain string literal anyway.
 *
 * Why it exists: 15 of these descriptions had drifted past 160 characters, so
 * search results truncated them mid-sentence, and nothing in the build
 * noticed. The failure mode is invisible in the running app and only shows up
 * in a search listing, which is exactly the kind of regression a cheap
 * source-level assertion is for.
 */
const MARKETING_DIR = join(__dirname, "..", "..", "app", "(marketing)");

/** Google truncates around 155-160 characters; 160 is the hard stop. */
const MAX_DESCRIPTION = 160;
/** Below this a description is leaving free space on the table. */
const MIN_DESCRIPTION = 70;
/** Titles render as "<title> | TarragonHealth"; ~60 is the display limit. */
const MAX_TITLE_WITH_SUFFIX = 60;

const TITLE_SUFFIX = ` | ${SITE.name}`;

/**
 * Pages whose metadata is NOT a literal in their own file. Product pages read
 * `_content/products.ts` and the two B2B pages read `_content/b2b.ts` (both
 * scanned below in their own right); the resource article route builds its
 * metadata from the database row. Asserted as an exact set so a NEW page
 * cannot quietly join it and skip the checks.
 */
const METADATA_ELSEWHERE = [
  "corporate/page.tsx",
  "diabetes/page.tsx",
  "hmo/page.tsx",
  "hypertension/page.tsx",
  "labs/page.tsx",
  "medication/page.tsx",
  "obesity/page.tsx",
  "parentcare/page.tsx",
  "prevention/page.tsx",
  "resources/[slug]/page.tsx",
].sort();

function walk(dir: string, match: (file: string) => boolean): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) out.push(...walk(full, match));
    else if (match(entry)) out.push(full);
  }
  return out;
}

/** Joins a string literal, including the `"a" + "b"` continuation form. */
function joinLiteral(raw: string): string {
  return [...raw.matchAll(/"((?:[^"\\]|\\.)*)"/g)]
    .map((m) => m[1]!)
    .join("")
    .replace(/\\"/g, '"');
}

type MetaPair = { file: string; title: string; description: string };

/**
 * Every `pageMetadata({ title, description })` / `metadata: { title,
 * description }` pair in a file. Scoped to those two call shapes so an
 * unrelated `{ title, body }` content object can never be mistaken for page
 * metadata. A `title:` naming a local const (the homepage's HOME_TITLE) is
 * resolved from that file's own `const NAME = "…"` declarations.
 */
function extractMetaPairs(file: string, source: string): MetaPair[] {
  const consts = new Map<string, string>(
    [...source.matchAll(/const\s+([A-Z][A-Z0-9_]*)\s*=\s*"((?:[^"\\]|\\.)*)"/g)].map((m) => [
      m[1]!,
      m[2]!,
    ])
  );

  const pattern =
    /(?:pageMetadata\(\{|metadata:\s*\{)[\s\S]{0,400}?title:\s*(?:"((?:[^"\\]|\\.)*)"|([A-Z][A-Z0-9_]*))\s*,\s*(?:\/\/[^\n]*\n\s*)*description:\s*\n?\s*("(?:[^"\\]|\\.)*"(?:\s*\+\s*\n?\s*"(?:[^"\\]|\\.)*")*)/g;

  return [...source.matchAll(pattern)].map((m) => ({
    file,
    title: m[1] !== undefined ? m[1] : (consts.get(m[2]!) ?? m[2]!),
    description: joinLiteral(m[3]!),
  }));
}

const pageFiles = walk(MARKETING_DIR, (name) => name === "page.tsx");
const contentFiles = [
  join(MARKETING_DIR, "_content", "products.ts"),
  join(MARKETING_DIR, "_content", "b2b.ts"),
];

const pairs: MetaPair[] = [];
const pagesWithoutInlineMetadata: string[] = [];

for (const file of pageFiles) {
  const found = extractMetaPairs(relative(MARKETING_DIR, file), readFileSync(file, "utf8"));
  if (found.length === 0) pagesWithoutInlineMetadata.push(relative(MARKETING_DIR, file));
  pairs.push(...found);
}
for (const file of contentFiles) {
  pairs.push(...extractMetaPairs(relative(MARKETING_DIR, file), readFileSync(file, "utf8")));
}

describe("marketing page metadata", () => {
  it("actually found the marketing pages (guards against a bad path)", () => {
    expect(pageFiles.length).toBeGreaterThan(20);
    expect(pairs.length).toBeGreaterThan(30);
  });

  it("only the known template-driven pages lack an inline description", () => {
    expect(pagesWithoutInlineMetadata.sort()).toEqual(METADATA_ELSEWHERE);
  });

  it.each(pairs.map((p) => [`${p.file} :: ${p.title}`, p] as const))(
    "%s has a description search engines will show in full",
    (_label, pair) => {
      expect(pair.description.length).toBeLessThanOrEqual(MAX_DESCRIPTION);
      expect(pair.description.length).toBeGreaterThanOrEqual(MIN_DESCRIPTION);
    }
  );

  it.each(pairs.map((p) => [`${p.file} :: ${p.title}`, p] as const))(
    "%s has a title that fits with the brand suffix",
    (_label, pair) => {
      // The homepage opts out of the "%s | TarragonHealth" template with an
      // absolute title, so it already carries the brand name and is measured
      // as-is.
      const rendered = pair.title.includes(SITE.name)
        ? pair.title
        : `${pair.title}${TITLE_SUFFIX}`;
      expect(rendered.length).toBeLessThanOrEqual(MAX_TITLE_WITH_SUFFIX);
    }
  );

  it("uses no em dashes in visitor-facing prose (standing brand rule)", () => {
    // Scoped to prose: a bare "—" is a legitimate "no value" glyph in the
    // comparison tables and the impact dashboard, and code comments in this
    // repo use em dashes freely and are never published.
    const offenders: string[] = [];
    for (const file of pageFiles) {
      const stripped = readFileSync(file, "utf8")
        .replace(/\/\*[\s\S]*?\*\//g, "")
        .replace(/^\s*\/\/.*$/gm, "");
      const prose = [...stripped.matchAll(/"((?:[^"\\]|\\.){20,})"/g)].map((m) => m[1]!);
      if (prose.some((text) => text.includes("—"))) {
        offenders.push(relative(MARKETING_DIR, file));
      }
    }
    expect(offenders).toEqual([]);
  });
});
