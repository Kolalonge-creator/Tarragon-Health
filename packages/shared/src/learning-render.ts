/**
 * How the two text-based content types are authored and read (S55, 9.1). No schema change: the body stays one text column.
 *
 * FAQ body: blocks separated by a blank line; each block is `Q: the question` then `A: the answer` (the answer may run over
 * several lines). Anything that does not parse falls back to plain text, so a badly authored FAQ still reads.
 *
 * Infographic body: optional first lines `image: https://...` and `alt: a plain description`, then the text version. The text
 * is always shown too, because a picture alone is no use on a screen reader, a data saver, or an offline phone.
 */
export interface FaqEntry {
  question: string;
  answer: string;
}

export function parseFaq(body: string | null | undefined): FaqEntry[] | null {
  if (!body) return null;
  const entries: FaqEntry[] = [];
  for (const block of body.split(/\r?\n\s*\r?\n/)) {
    // Line-by-line instead of one backtracking pattern: the Q line, then the first later line that starts with A:.
    const lines = block.split(/\r?\n/);
    const q = lines.findIndex((l) => l.trim() !== "");
    if (q < 0 || !(lines[q] ?? "").trimStart().startsWith("Q:")) continue;
    const a = lines.findIndex((l, i) => i > q && l.trimStart().startsWith("A:"));
    if (a < 0) continue;
    const question = [(lines[q] ?? "").trimStart().slice(2), ...lines.slice(q + 1, a)].join("\n").trim();
    const answer = [(lines[a] ?? "").trimStart().slice(2), ...lines.slice(a + 1)].join("\n").trim();
    if (question && answer) entries.push({ question: question.replace(/\s+/g, " "), answer });
  }
  return entries.length > 0 ? entries : null;
}

export interface InfographicParts {
  imageUrl: string | null;
  alt: string;
  text: string;
}

export function parseInfographic(body: string | null | undefined): InfographicParts {
  const lines = (body ?? "").split(/\r?\n/);
  let imageUrl: string | null = null;
  let alt = "";
  let i = 0;
  for (; i < lines.length; i++) {
    const line = lines[i] ?? "";
    const img = /^image:\s*(\S+)\s*$/i.exec(line);
    const altRaw = /^alt:/i.test(line) ? line.slice(4) : null;
    if (img?.[1]) {
      // Only https images from a known-safe shape; anything else is ignored rather than rendered.
      imageUrl = /^https:\/\/[^\s"'<>]+$/.test(img[1]) ? img[1] : null;
    } else if (altRaw !== null && altRaw.length > 0) {
      alt = altRaw.trim();
    } else if (line.trim() !== "") {
      break;
    }
  }
  return { imageUrl, alt, text: lines.slice(i).join("\n").trim() };
}
