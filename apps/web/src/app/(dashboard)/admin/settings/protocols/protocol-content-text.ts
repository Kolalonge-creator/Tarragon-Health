/**
 * The readable body of a protocol's `content` column, whether it belongs to
 * a signed `protocol_versions` row or an unsigned `protocol_drafts` one —
 * both are jsonb, both are written by the same two forms on this page, and
 * both need the same fallback.
 *
 * The signing/drafting forms write `{ text }`, but the column is free-form:
 * three pre-existing protocol_versions rows hold structured objects with no
 * `text` key at all. Falling back to pretty JSON means every row renders
 * something readable instead of "[object Object]" or nothing.
 *
 * Its own module rather than living inside either manager component: a
 * Director reviewing a DRAFT needs to read the same content a Director
 * reading a SIGNED version does, and a copy in each file is how the two
 * would eventually say different things about the same shape of data.
 */
export function protocolContentText(content: unknown): string {
  if (content == null) return "";
  if (typeof content === "string") return content;
  if (typeof content === "object" && "text" in (content as Record<string, unknown>)) {
    const text = (content as Record<string, unknown>).text;
    if (typeof text === "string") return text;
  }
  try {
    return JSON.stringify(content, null, 2);
  } catch {
    return "";
  }
}
