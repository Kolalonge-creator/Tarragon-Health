/** First value of a Next search parameter, trimmed and capped so a long query string cannot flood a page. */
export function firstParam(value: string | string[] | undefined): string | undefined {
  const v = Array.isArray(value) ? value[0] : value;
  if (typeof v !== "string") return undefined;
  const t = v.trim();
  return t === "" ? undefined : t.slice(0, 400);
}

export type SearchParams = Promise<Record<string, string | string[] | undefined>>;
