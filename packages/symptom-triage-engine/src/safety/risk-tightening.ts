/**
 * Nigerian prevalence and seasonal risk (spec 12.2, 12.11), as versioned configuration that can only TIGHTEN urgency.
 *
 * SHAPE OF THE GUARANTEE. The only thing a risk entry can do is name a MINIMUM category. The result is
 * `mostUrgentCategory(current, minimum)`, which by construction is never less urgent than `current`. There is no field that
 * sets, lowers or replaces a category, the zod schema is strict (an unknown key is a parse failure, not an ignored key), and
 * `risk-tightening.test.ts` proves, over every category and every entry, that no input can lower a result.
 *
 * SIGN-OFF. An entry only applies when it carries a recorded clinical sign-off (`status: "signed_off"` and a named signer and
 * date). The config shipped in the repository is DRAFT: every entry's `status` is "draft", so the layer is inert until the CMO
 * signs a version. This module never signs anything and never invents content: the entries are structure plus a clearly
 * marked placeholder that cannot take effect unsigned.
 *
 * This is not a diagnosis input. It reads a month, a state, the symptoms already captured and the history already captured,
 * and nothing else. The function is pure and deterministic (INV-01).
 */
import { z } from "zod";
import { TRIAGE_CATEGORIES, mostUrgentCategory, type SymptomCapture, type TriageCategory } from "../types/index";

const categorySchema = z.enum(TRIAGE_CATEGORIES);

export const riskEntrySchema = z
  .object({
    id: z.string().regex(/^[a-z][a-z0-9_]*$/),
    label: z.string().min(1),
    /** Where the claim comes from. A draft entry may say "unverified"; a signed one must name a source. */
    provenance: z.object({ source: z.string().min(1), note: z.string().min(1) }).strict(),
    status: z.enum(["draft", "signed_off"]),
    clinical_sign_off: z.object({ by: z.string().min(1), at: z.string().regex(/^\d{4}-\d{2}-\d{2}$/) }).strict().nullable(),
    applies_when: z
      .object({
        /** 1 to 12. Empty or absent means every month. */
        months: z.array(z.number().int().min(1).max(12)).optional(),
        /** Nigerian state names as held on the profile. Empty or absent means everywhere. */
        states: z.array(z.string().min(1)).optional(),
        complaint_keys: z.array(z.string().min(1)).optional(),
        any_associated_symptom: z.array(z.string().min(1)).optional(),
        any_history: z.array(z.string().min(1)).optional(),
      })
      .strict(),
    /** The most this entry can do: raise a result to AT LEAST this category. */
    minimum_category: categorySchema,
  })
  .strict();
export type RiskEntry = z.infer<typeof riskEntrySchema>;

export const riskTighteningConfigSchema = z.object({ entries: z.array(riskEntrySchema) }).strict();
export type RiskTighteningConfig = z.infer<typeof riskTighteningConfigSchema>;

export interface RiskContext {
  capture: SymptomCapture;
  /** 1 to 12, Africa/Lagos. */
  month: number;
  /** profiles.state, or null when unknown. An entry that names states still applies when the state is unknown: possibly inside is the safe direction. */
  state: string | null;
}

export interface TighteningResult {
  category: TriageCategory;
  /** Ids of the entries that actually raised the category. */
  raisedBy: string[];
  /** Ids of entries that matched but did not raise anything (already at or above their minimum). */
  matchedNoChange: string[];
}

function isInForce(entry: RiskEntry): boolean {
  return entry.status === "signed_off" && entry.clinical_sign_off !== null;
}

export function entryApplies(entry: RiskEntry, ctx: RiskContext): boolean {
  const w = entry.applies_when;
  if (w.months && w.months.length > 0 && !w.months.includes(ctx.month)) return false;
  if (w.states && w.states.length > 0 && ctx.state !== null) {
    const want = new Set(w.states.map((s) => s.trim().toLowerCase()));
    if (!want.has(ctx.state.trim().toLowerCase())) return false;
  }
  if (w.complaint_keys && w.complaint_keys.length > 0 && !w.complaint_keys.includes(ctx.capture.presentingComplaintKey)) return false;
  if (w.any_associated_symptom && w.any_associated_symptom.length > 0 && !w.any_associated_symptom.some((s) => ctx.capture.associatedSymptoms.includes(s))) return false;
  if (w.any_history && w.any_history.length > 0 && !w.any_history.some((h) => ctx.capture.relevantHistory.includes(h))) return false;
  return true;
}

/** Raise `current` to at least the minimum of every signed, matching entry. Never lowers. Malformed config applies nothing. */
export function applyRiskTightening(current: TriageCategory, ctx: RiskContext, rawConfig: unknown): TighteningResult {
  const parsed = riskTighteningConfigSchema.safeParse(rawConfig);
  if (!parsed.success) return { category: current, raisedBy: [], matchedNoChange: [] };
  let category = current;
  const raisedBy: string[] = [];
  const matchedNoChange: string[] = [];
  for (const entry of parsed.data.entries) {
    if (!isInForce(entry) || !entryApplies(entry, ctx)) continue;
    const next = mostUrgentCategory(category, entry.minimum_category);
    if (next !== category) {
      category = next;
      raisedBy.push(entry.id);
    } else {
      matchedNoChange.push(entry.id);
    }
  }
  return { category, raisedBy, matchedNoChange };
}
