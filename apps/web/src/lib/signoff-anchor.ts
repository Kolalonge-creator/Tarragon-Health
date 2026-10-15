/**
 * The page anchor of a line on the Chief Medical Officer's sign-off hub, so the S06 to S10 banner (and anything else)
 * can link straight to the panel that signs it. Keys contain colons and dots, which are legal in an id but awkward in a
 * selector, so they are flattened.
 */
export function signoffAnchorId(key: string): string {
  return `item-${key.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "")}`;
}
