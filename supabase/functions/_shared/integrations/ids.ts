/** Opaque ids (uuids) are the only thing a room, a token or a transcript stream may be keyed by; never a name. */
export const isUuid = (s: unknown): s is string => typeof s === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(s);

/**
 * A plain shape check for an email address: no spaces, exactly one "@", something before it, and a dot with something on
 * both sides after it. Written as a scan, not a regular expression, so a hostile string cannot make it slow.
 */
export function isEmailShape(s: unknown): s is string {
  if (typeof s !== "string" || s.length === 0 || s.length > 254) return false;
  let at = -1;
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    if (c <= 32 || c === 127) return false;
    if (s[i] === "@") {
      if (at !== -1) return false;
      at = i;
    }
  }
  if (at < 1) return false;
  const domainStart = at + 1;
  for (let i = domainStart + 1; i < s.length - 1; i++) if (s[i] === ".") return true;
  return false;
}
