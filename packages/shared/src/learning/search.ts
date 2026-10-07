import { getProposedConfig } from "../proposed-config";

/** One group of words that all mean the same to a searcher ("bp", "blood pressure", "high blood"...). */
export interface SynonymGroup {
  readonly terms: readonly string[];
}

/** Lower-case, letters and digits only, single spaces. Mirrors private.learning_norm() in the database. */
export function normaliseQuery(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

/** The synonym groups in force, from versioned configuration (never hard-coded at a call site). */
export function loadSynonymGroups(asOf?: string): readonly SynonymGroup[] {
  const cfg = getProposedConfig("learning.search_synonyms", asOf);
  return (cfg.value as unknown as { groups: readonly SynonymGroup[] }).groups;
}

/**
 * The phrase itself plus every term in any group that contains a whole word or phrase from it. Mirrors the
 * expansion in public.search_health_education(), so a phone searching its downloads finds what the server would.
 */
export function expandSearchTerms(query: string, groups: readonly SynonymGroup[] = loadSynonymGroups()): string[] {
  const q = normaliseQuery(query);
  if (q.length < 2) return [];
  const padded = ` ${q} `;
  const out = new Set<string>([q]);
  for (const group of groups) {
    if (group.terms.some((t) => padded.includes(` ${normaliseQuery(t)} `))) {
      for (const t of group.terms) out.add(normaliseQuery(t));
    }
  }
  return [...out];
}

export interface SearchableItem {
  readonly title: string;
  readonly summary?: string | null;
  readonly body?: string | null;
}

/** Local search over items already on the phone. A title match ranks above a body match; no match, no row. */
export function searchLocal<T extends SearchableItem>(
  items: readonly T[],
  query: string,
  groups: readonly SynonymGroup[] = loadSynonymGroups(),
): T[] {
  const terms = expandSearchTerms(query, groups);
  if (terms.length === 0) return [];
  const score = (item: T): number => {
    const title = ` ${normaliseQuery(item.title)} `;
    const rest = ` ${normaliseQuery(`${item.summary ?? ""} ${item.body ?? ""}`)} `;
    let s = 0;
    for (const t of terms) {
      if (title.includes(` ${t} `)) s += 2;
      else if (rest.includes(` ${t} `)) s += 1;
    }
    return s;
  };
  return items
    .map((item) => ({ item, s: score(item) }))
    .filter((x) => x.s > 0)
    .sort((a, b) => b.s - a.s)
    .map((x) => x.item);
}
