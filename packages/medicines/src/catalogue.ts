/**
 * Search-as-you-type over the Nigerian medicine catalogue (spec 8.2, S53).
 *
 * Pure and offline: the app loads the (small) active catalogue once, keeps it on the phone, and ranks locally, so a slow
 * connection never blocks adding a medicine. The catalogue only SUGGESTS. Choosing a suggestion fills the form; the patient
 * still confirms every field (8.3), and typing a name that is not in the catalogue is always allowed.
 */

export interface CatalogueEntry {
  id: string;
  /** Brand name as sold, or null for a plain generic entry. */
  brandName: string | null;
  genericName: string;
  strength: string | null;
  form: string | null;
  /** Only ever a number a pharmacist copied from the register. Null means "not recorded", never "none". */
  nafdacNumber: string | null;
  /** True only after a pharmacist checked the row against NAFDAC's register. */
  isVerified: boolean;
}

export interface CatalogueMatch {
  entry: CatalogueEntry;
  /** Lower is better. */
  rank: number;
}

/** Lower case, accents and punctuation out, single spaces. */
export function normaliseQuery(text: string): string {
  return text
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9% ]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function rankName(name: string, q: string): number | null {
  if (name === q) return 0;
  if (name.startsWith(q)) return 1;
  if (name.split(" ").some((w) => w.startsWith(q))) return 2;
  if (name.includes(q)) return 3;
  return null;
}

/**
 * Rank catalogue entries for a query of at least two characters. Brand and generic names both match; a match on the
 * generic ranks the same as on the brand so a patient who knows only the box name or only the chemical name finds it.
 * Ties break on shorter names, then alphabetically, so the order is stable.
 */
export function searchCatalogue(entries: readonly CatalogueEntry[], query: string, limit = 8): CatalogueMatch[] {
  const q = normaliseQuery(query);
  if (q.length < 2) return [];
  const out: CatalogueMatch[] = [];
  for (const entry of entries) {
    const generic = rankName(normaliseQuery(entry.genericName), q);
    const brand = entry.brandName ? rankName(normaliseQuery(entry.brandName), q) : null;
    const best = generic === null ? brand : brand === null ? generic : Math.min(generic, brand);
    if (best !== null) out.push({ entry, rank: best });
  }
  out.sort((a, b) => {
    if (a.rank !== b.rank) return a.rank - b.rank;
    const an = `${a.entry.genericName} ${a.entry.brandName ?? ""} ${a.entry.strength ?? ""}`;
    const bn = `${b.entry.genericName} ${b.entry.brandName ?? ""} ${b.entry.strength ?? ""}`;
    return an.length !== bn.length ? an.length - bn.length : an.localeCompare(bn);
  });
  return out.slice(0, Math.max(0, limit));
}

/** What choosing a suggestion fills into the add form. The patient confirms or edits each value. */
export interface CataloguePrefill {
  drugName: string;
  strength: string | null;
  form: string | null;
  brandName: string | null;
  nafdacNumber: string | null;
  isVerified: boolean;
}

export function prefillFromCatalogue(entry: CatalogueEntry): CataloguePrefill {
  return {
    drugName: entry.genericName,
    strength: entry.strength,
    form: entry.form,
    brandName: entry.brandName,
    nafdacNumber: entry.nafdacNumber,
    isVerified: entry.isVerified,
  };
}

/** The short label shown under a suggestion, for example "Amlodipine 5 mg tablet (Norvasc)". */
export function catalogueLabel(entry: CatalogueEntry): string {
  const base = [entry.genericName, entry.strength, entry.form].filter((p): p is string => !!p).join(" ");
  return entry.brandName ? `${base} (${entry.brandName})` : base;
}
