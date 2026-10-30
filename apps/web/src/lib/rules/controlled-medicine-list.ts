/**
 * The controlled-medicine list as the web sees it (OQ-484, 2026-10-30).
 *
 * There is ONE list, in the database: `public.controlled_medicine_terms`, edited by the Chief Medical Officer through
 * `set_controlled_medicine_term` and read by the signing hard stop and every pharmacy counter path through
 * `private.is_controlled_medicine`. The web reads the same rows through `get_controlled_medicine_list()`.
 *
 * Nothing in this file is a list of drug names. The only names in the web bundle are in
 * `controlled-medicine-terms.generated.ts`, written by `scripts/generate-controlled-medicine-fallback.ts` from the seed in the migration
 * that created the table. It is used only when the database cannot be read, so a guard never silently turns off. Refresh it with
 * `pnpm --filter @tarragon/web controlled-medicine-fallback` after the CMO changes the list for good.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import type { Database } from "@tarragon/shared";
import { CONTROLLED_MEDICINE_FALLBACK, CONTROLLED_MEDICINE_FALLBACK_VERSION } from "./controlled-medicine-terms.generated";

export type ControlledSubstanceTier = "narcotic" | "restricted";

export interface ControlledMedicineTerm {
  term: string;
  tier: ControlledSubstanceTier;
  label: string;
}

export interface ControlledMedicineList {
  /** The list version (the highest history id). 0 means "not read from the database". */
  version: number;
  terms: readonly ControlledMedicineTerm[];
  source: "database" | "fallback";
}

const termSchema = z.object({
  term: z.string().trim().min(1),
  tier: z.enum(["narcotic", "restricted"]),
  label: z.string().trim().min(1),
});

const listSchema = z.object({
  version: z.number().int().nonnegative(),
  terms: z.array(termSchema),
});

/** The list generated from the migration seed. Used when the database cannot be read. */
export function fallbackControlledMedicineList(): ControlledMedicineList {
  return { version: CONTROLLED_MEDICINE_FALLBACK_VERSION, terms: CONTROLLED_MEDICINE_FALLBACK, source: "fallback" };
}

/**
 * Null when the response is not a well-formed list. An EMPTY list is treated as malformed too: the database refuses to retire the last term, so an empty
 * answer means something is wrong, and the safe direction is the generated fallback, never "nothing is controlled".
 */
export function parseControlledMedicineList(raw: unknown): ControlledMedicineList | null {
  const parsed = listSchema.safeParse(raw);
  if (!parsed.success || parsed.data.terms.length === 0) return null;
  return { version: parsed.data.version, terms: parsed.data.terms, source: "database" };
}

type Client = Pick<SupabaseClient<Database>, "rpc">;

function usingFallback(reason: string): ControlledMedicineList {
  // Visible in the server log or browser console: a guard running on the generated list can drift from the database list without anyone noticing.
  console.warn(`controlled-medicine list: using the generated fallback (${reason})`);
  return fallbackControlledMedicineList();
}

/** Reads the list through `get_controlled_medicine_list`. Never throws: any failure returns the generated fallback, and says so in the log. */
export async function loadControlledMedicineList(supabase: Client): Promise<ControlledMedicineList> {
  try {
    const { data, error } = await supabase.rpc("get_controlled_medicine_list");
    if (error) return usingFallback("the read failed");
    return parseControlledMedicineList(data) ?? usingFallback("the answer was empty or malformed");
  } catch {
    return usingFallback("the read threw");
  }
}

const matcherCache = new WeakMap<readonly ControlledMedicineTerm[], { term: ControlledMedicineTerm; pattern: RegExp }[]>();

function matchersFor(terms: readonly ControlledMedicineTerm[]) {
  const cached = matcherCache.get(terms);
  if (cached) return cached;
  // Narcotic first, so a name that matches both tiers gets the stricter advice. Terms are letters, digits, spaces and hyphens only (the database
  // enforces this), but they are escaped anyway: a term can never become a pattern.
  const ordered = [...terms].sort((a, b) => (a.tier === b.tier ? a.term.localeCompare(b.term) : a.tier === "narcotic" ? -1 : 1));
  const built = ordered.map((term) => ({
    term,
    pattern: new RegExp(`\\b${term.term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "i"),
  }));
  matcherCache.set(terms, built);
  return built;
}

/** The term that matches a drug name, or null. Null means "no rule fired", never "confirmed not controlled". */
export function matchControlledMedicineTerm(list: ControlledMedicineList, drugName: string): ControlledMedicineTerm | null {
  const trimmed = drugName.trim();
  if (!trimmed) return null;
  for (const entry of matchersFor(list.terms)) {
    if (entry.pattern.test(trimmed)) return entry.term;
  }
  return null;
}
