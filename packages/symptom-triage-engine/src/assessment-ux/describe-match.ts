/**
 * S59c: "describe it" entry. The person types what is wrong in their own words; a versioned synonym table maps the words to ONE of the
 * signed, active pathways, or to "could not match". Deterministic string matching only: no model, no embeddings, no network (INV-01).
 *
 * ORDER OF EVENTS IS THE SAFETY RULE.
 *   1. The shared danger-phrase screen runs over the raw text first, on the device. A hit is returned as `danger` and nothing else is
 *      looked at: no synonym, however exact, can outrank it. A screen that throws counts as a hit (fail toward escalation).
 *   2. Only then is the synonym table consulted. An unsigned or malformed table matches nothing.
 *   3. A weak or ambiguous match is never turned into reassurance. `no_match` and `ambiguous` both send the person to the ordinary
 *      safety checklist and the pathway picker; the caller never invents a result from them.
 *
 * PRIVACY. The text is only ever an argument. Nothing returned contains any of it (no echo, no matched fragment), so a caller that
 * logs the result logs no health text. The caller must not store the text; it lives in component state for the session.
 *
 * NOTHING HERE LOWERS AN URGENCY: this module produces a route to a pathway, never a category. The category still comes from the
 * red-flag floor and the signed engine.
 */
import { z } from "zod";
import { envelopeShape, normaliseText, parseInForce } from "./ux-config";

export const MAX_DESCRIBE_CHARS = 1000;

export const describeEntrySchema = z
  .object({
    id: z.string().regex(/^[a-z][a-z0-9_]*$/),
    pathway_key: z.string().regex(/^[a-z][a-z0-9_]*$/),
    /** 1 for a weak hint, 2 for a clear phrase, 3 for an unmistakable one. */
    weight: z.number().int().min(1).max(3),
    /** Lower case. A trailing `*` makes a stem. A phrase starts at a word boundary. */
    phrases: z.array(z.string().min(2).max(60)).min(1).max(40),
  })
  .strict();

export const describeTableSchema = z
  .object({
    ...envelopeShape,
    /** The lowest score a pathway needs to be suggested at all. */
    min_score: z.number().int().min(1).max(10),
    /** Kept for the stored shape; any second pathway that scores at all now makes the result "ambiguous". */
    ambiguity_margin: z.number().int().min(1).max(10),
    /** The least time between two "danger wording found" events for one person. The database reads this (rate limit); the screens ignore it. */
    danger_event_min_gap_minutes: z.number().int().min(1).max(1440),
    entries: z.array(describeEntrySchema).min(1).max(200),
  })
  .strict();
export type DescribeTable = z.infer<typeof describeTableSchema>;

export type DescribeMatch =
  | { kind: "match"; pathwayKey: string; score: number }
  | { kind: "ambiguous"; candidates: string[] }
  | { kind: "no_match" };

export type DescribeOutcome = { kind: "danger"; selfHarm: boolean; screenFailed: boolean } | DescribeMatch;

/** What the shared danger-phrase screen returns (`screenAssistantMessage`), reduced to what this module needs. */
export interface DangerScreenResult {
  redFlag: boolean;
  selfHarm?: boolean;
}
export type DangerScreen = (text: string) => DangerScreenResult;

const escapeRegex = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** Same rule as the assistant danger screen: the START is a word boundary ("ache" never matches "headache"); `*` makes a stem; the end is open. */
function phraseRegex(entry: string): RegExp {
  const stem = entry.endsWith("*");
  const body = escapeRegex(stem ? entry.slice(0, -1) : entry).replace(/\s+/g, "\\s+");
  return new RegExp(`(?<![a-z0-9])${body}`);
}

/**
 * Score the text against the table. `available` is the set of SIGNED, ACTIVE pathway keys: an entry for any other pathway is ignored,
 * so the table can carry entries for pathways that are not signed yet without ever routing to one.
 */
export function matchDescription(text: string, rawTable: unknown, available: readonly string[]): DescribeMatch {
  const table = parseInForce(describeTableSchema, rawTable);
  if (!table) return { kind: "no_match" };
  const haystack = normaliseText(text.slice(0, MAX_DESCRIBE_CHARS));
  if (haystack.length === 0) return { kind: "no_match" };
  const allowed = new Set(available);
  const scores = new Map<string, number>();
  for (const entry of table.entries) {
    if (!allowed.has(entry.pathway_key)) continue;
    if (entry.phrases.some((p) => phraseRegex(p.toLowerCase()).test(haystack))) {
      scores.set(entry.pathway_key, (scores.get(entry.pathway_key) ?? 0) + entry.weight);
    }
  }
  const ranked = [...scores.entries()].sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1));
  const top = ranked[0];
  if (!top || top[1] < table.min_score) return { kind: "no_match" };
  // A second complaint, even a weak one, may be the more dangerous one ("headache and my chest is tight"): if ANY other available
  // pathway scored above zero the answer is a choice between all of them, never a silent pick of the strongest.
  if (ranked.length > 1) return { kind: "ambiguous", candidates: ranked.map(([k]) => k) };
  return { kind: "match", pathwayKey: top[0], score: top[1] };
}

/**
 * The whole entry step: danger screen first, then the table. Pure and synchronous (works with no connection).
 * `dangerScreen` is injected so this package needs no dependency on the shared screen; the apps pass `screenAssistantMessage`.
 */
export function describeEntry(text: string, opts: { dangerScreen: DangerScreen; table: unknown; available: readonly string[] }): DescribeOutcome {
  // The screen sees the whole text up to a generous cap, not the shorter matching window: a danger phrase late in a long note still counts.
  const screened = text.slice(0, MAX_DESCRIBE_CHARS * 2);
  let danger: DangerScreenResult | null = null;
  try {
    danger = opts.dangerScreen(screened);
  } catch {
    return { kind: "danger", selfHarm: false, screenFailed: true };
  }
  if (!danger || typeof danger.redFlag !== "boolean") return { kind: "danger", selfHarm: false, screenFailed: true };
  if (danger.redFlag) return { kind: "danger", selfHarm: danger.selfHarm === true, screenFailed: false };
  return matchDescription(text, opts.table, opts.available);
}
