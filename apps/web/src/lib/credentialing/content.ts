/**
 * Parsing for the Chief Medical Officer's content forms (S15). Pure, so it can be tested; the server action only
 * calls it. Scenarios and training are clinical content the CMO writes and approves: nothing here invents any.
 */
const OPTION_LINE = /^\s*([a-z0-9_-]{1,20})\s*[|:]\s*(.+?)\s*$/i;

/** "a | Give oxygen" lines become options. Null when a line is malformed, there are fewer than two, or ids repeat. */
export function parseOptions(raw: string): { id: string; text: string }[] | null {
  const lines = raw
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean);
  const options: { id: string; text: string }[] = [];
  for (const line of lines) {
    const m = OPTION_LINE.exec(line);
    if (!m?.[1] || !m[2]) return null;
    options.push({ id: m[1], text: m[2] });
  }
  return options.length >= 2 && new Set(options.map((o) => o.id)).size === options.length ? options : null;
}

/** Paragraphs separated by a blank line become the cards of a training module. */
export function paragraphsToContent(raw: string): { type: "text"; body: string }[] {
  return raw
    .split(/\n\s*\n/)
    .map((p) => p.trim())
    .filter(Boolean)
    .map((body) => ({ type: "text" as const, body }));
}

/** The reverse, for editing an existing module. */
export function contentToParagraphs(content: ReadonlyArray<{ body?: string }>): string {
  return content
    .map((c) => c.body ?? "")
    .filter(Boolean)
    .join("\n\n");
}
