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
    const m = /^\s*Q:\s*([\s\S]+?)\s*\r?\n\s*A:\s*([\s\S]+?)\s*$/.exec(block);
    if (m?.[1] && m[2]) entries.push({ question: m[1].replace(/\s+/g, " "), answer: m[2].trim() });
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
    const altm = /^alt:\s*(.+)$/i.exec(line);
    if (img?.[1]) {
      // Only https images from a known-safe shape; anything else is ignored rather than rendered.
      imageUrl = /^https:\/\/[^\s"'<>]+$/.test(img[1]) ? img[1] : null;
    } else if (altm?.[1]) {
      alt = altm[1].trim();
    } else if (line.trim() !== "") {
      break;
    }
  }
  return { imageUrl, alt, text: lines.slice(i).join("\n").trim() };
}
